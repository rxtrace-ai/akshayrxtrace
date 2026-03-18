import { NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function daysRemaining(expiresAtIso: string | null): number {
  if (!expiresAtIso) return 0;
  const expires = new Date(expiresAtIso).getTime();
  if (Number.isNaN(expires)) return 0;
  const diffMs = expires - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeStatus(value: unknown): "active" | "pending" | "expired" | "cancelled" {
  const parsed = String(value || "").trim().toLowerCase();
  if (["active", "authenticated", "activated", "charged"].includes(parsed)) return "active";
  if (["cancelled", "canceled"].includes(parsed)) return "cancelled";
  if (["pending", "pending_payment", "trial", "trialing"].includes(parsed)) return "pending";
  return "expired";
}

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const entitlement = await getCompanyEntitlementSnapshot(owner.supabase, owner.companyId);
    const nowIso = new Date().toISOString();

    const { data: activeQuotaRows, error: activeQuotaError } = await owner.supabase
      .from("quota_allocations")
      .select("resource, amount")
      .eq("company_id", owner.companyId)
      .gt("expires_at", nowIso);
    if (activeQuotaError) {
      return NextResponse.json({ error: activeQuotaError.message }, { status: 500 });
    }

    const allocatedByResource = (activeQuotaRows || []).reduce<Record<string, number>>((acc, row: any) => {
      const resource = String(row?.resource || "").trim().toLowerCase();
      const amount = Math.max(0, Number(row?.amount || 0));
      if (!resource) return acc;
      acc[resource] = (acc[resource] || 0) + amount;
      return acc;
    }, {});
    const totalQuota = Object.values(allocatedByResource).reduce((sum, value) => sum + value, 0);

    const subscriptionStatus = await getUnifiedSubscriptionStatus({
      supabase: owner.supabase as any,
      companyId: owner.companyId,
    });

    const currentSubscription = subscriptionStatus.subscription ?? null;
    const subTemplate = (currentSubscription as any)?.subscription_plan_templates || null;

    const { data: structuralAddOns, error: structuralError } = await owner.supabase
      .from("company_addon_subscriptions")
      .select("addon_id, quantity, status, add_ons(name, entitlement_key, addon_kind, billing_mode)")
      .eq("company_id", owner.companyId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (structuralError) {
      return NextResponse.json({ error: structuralError.message }, { status: 500 });
    }

    const { data: invoices, error: invoiceError } = await owner.supabase
      .from("billing_invoices")
      .select(
        "id, invoice_type, status, reference, plan, amount, currency, period_start, period_end, due_at, issued_at, paid_at, invoice_pdf_url, created_at"
      )
      .eq("company_id", owner.companyId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    const codeTypes = ["unit", "box", "carton", "pallet"] as const;
    const quotaTable = codeTypes.map((metric) => {
      const allocatedFromLedger = Math.max(0, Math.trunc(allocatedByResource[metric] || 0));
      const consumed = entitlement.usage?.[metric] ?? 0;
      const remaining = Math.max(allocatedFromLedger - consumed, 0);
      return {
        metric,
        allocated: allocatedFromLedger,
        subscription_allocated: allocatedFromLedger,
        addon_allocated: 0,
        consumed,
        remaining,
      };
    });

    const decisions = {
      generation: (() => {
        const status = subscriptionStatus.status;
        if (status === "cancelled") return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
        if (status === "expired") return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
        const remaining = quotaTable.reduce((sum, row) => sum + row.remaining, 0);
        if (remaining <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
        return { blocked: false, code: null };
      })(),
      seats: (() => {
        if (["cancelled", "expired"].includes(subscriptionStatus.status)) {
          return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
        }
        if ((entitlement.remaining.seat ?? 0) <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
        return { blocked: false, code: null };
      })(),
      plants: (() => {
        if (["cancelled", "expired"].includes(subscriptionStatus.status)) {
          return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
        }
        if ((entitlement.remaining.plant ?? 0) <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
        return { blocked: false, code: null };
      })(),
    };

    return NextResponse.json({
      success: true,
      company: { id: owner.companyId, name: owner.companyName },
      state: entitlement.state,
      trial: {
        active: entitlement.trial_active,
        expires_at: entitlement.trial_expires_at,
        days_remaining: entitlement.trial_active ? daysRemaining(entitlement.trial_expires_at) : 0,
      },
      period: {
        start: entitlement.period_start,
        end: entitlement.period_end,
      },
      subscription: currentSubscription
        ? {
            status: normalizeStatus((currentSubscription as any).status),
            cancel_at_period_end: Boolean((currentSubscription as any).cancel_at_period_end),
            current_period_start: (currentSubscription as any).current_period_start ?? null,
            current_period_end: (currentSubscription as any).current_period_end ?? null,
            next_billing_at: (currentSubscription as any).next_billing_at ?? null,
            start_date: (currentSubscription as any).start_date ?? null,
            renewal_date: (currentSubscription as any).renewal_date ?? null,
            plan_name: subTemplate?.name ?? null,
            billing_cycle:
              (currentSubscription as any).billing_cycle ??
              subTemplate?.billing_cycle ??
              null,
            plan_price_paise: subTemplate?.plan_price ?? 0,
          }
        : null,
      subscriptionStatus: {
        status: subscriptionStatus.status,
        trialExpiresAt: subscriptionStatus.trialExpiresAt ? subscriptionStatus.trialExpiresAt.toISOString() : null,
      },
      entitlement,
      total_quota: Math.max(0, Math.trunc(totalQuota)),
      quota_table: quotaTable,
      decisions,
      capacity_addons: (structuralAddOns || [])
        .filter((row: any) => {
          const addon = row.add_ons;
          return addon?.addon_kind === "structural" && addon?.billing_mode === "recurring";
        })
        .map((row: any) => ({
          addon_id: row.addon_id,
          name: row.add_ons?.name ?? null,
          entitlement_key: row.add_ons?.entitlement_key ?? null,
          quantity: row.quantity,
          status: row.status,
        })),
      add_on_balances: {
        unit: entitlement.topups?.unit ?? 0,
        box: entitlement.topups?.box ?? 0,
        carton: entitlement.topups?.carton ?? 0,
        pallet: entitlement.topups?.pallet ?? 0,
      },
      invoices: (invoices || []).map((row: any) => ({
        id: row.id,
        invoice_type: row.invoice_type,
        status: row.status,
        reference: row.reference,
        plan: row.plan,
        amount: row.amount,
        currency: row.currency,
        period_start: row.period_start,
        period_end: row.period_end,
        due_at: row.due_at,
        issued_at: row.issued_at,
        paid_at: row.paid_at,
        invoice_pdf_url: row.invoice_pdf_url || `/api/billing/invoice/${row.id}/pdf`,
        created_at: row.created_at,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Dashboard summary failed" },
      { status: 500 }
    );
  }
}

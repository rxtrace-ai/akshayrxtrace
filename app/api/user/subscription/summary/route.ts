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

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const entitlement = await getCompanyEntitlementSnapshot(owner.supabase, owner.companyId);

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
        "invoice_type, status, reference, plan, amount, currency, period_start, period_end, due_at, issued_at, paid_at, invoice_pdf_url, created_at"
      )
      .eq("company_id", owner.companyId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }

    const decisionFromState = (state: string): "TRIAL_EXPIRED" | "NO_ACTIVE_SUBSCRIPTION" | null => {
      if (state === "TRIAL_EXPIRED") return "TRIAL_EXPIRED";
      if (state === "NO_ACTIVE_SUBSCRIPTION") return "NO_ACTIVE_SUBSCRIPTION";
      return null;
    };

    const decisions = {
      generation: (() => {
        const stateCode = decisionFromState(entitlement.state);
        if (entitlement.blocked && stateCode) return { blocked: true, code: stateCode as const };
        const remaining =
          (entitlement.remaining.unit ?? 0) +
          (entitlement.remaining.box ?? 0) +
          (entitlement.remaining.carton ?? 0) +
          (entitlement.remaining.pallet ?? 0);
        if (remaining <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
        return { blocked: false, code: null };
      })(),
      seats: (() => {
        const stateCode = decisionFromState(entitlement.state);
        if (entitlement.blocked && stateCode) return { blocked: true, code: stateCode as const };
        if ((entitlement.remaining.seat ?? 0) <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
        return { blocked: false, code: null };
      })(),
      plants: (() => {
        const stateCode = decisionFromState(entitlement.state);
        if (entitlement.blocked && stateCode) return { blocked: true, code: stateCode as const };
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
            status: String((currentSubscription as any).status || "").toLowerCase() || null,
            cancel_at_period_end: Boolean((currentSubscription as any).cancel_at_period_end),
            current_period_start: (currentSubscription as any).current_period_start ?? null,
            current_period_end: (currentSubscription as any).current_period_end ?? null,
            next_billing_at: (currentSubscription as any).next_billing_at ?? null,
            plan_name: subTemplate?.name ?? null,
            billing_cycle: subTemplate?.billing_cycle ?? null,
            amount_paise: subTemplate?.amount_from_razorpay ?? 0,
          }
        : null,
      subscriptionStatus: {
        status: subscriptionStatus.status,
        trialExpiresAt: subscriptionStatus.trialExpiresAt ? subscriptionStatus.trialExpiresAt.toISOString() : null,
      },
      entitlement,
      decisions,
      structural_addons: (structuralAddOns || [])
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
      invoices: (invoices || []).map((row: any) => ({
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
        invoice_pdf_url: row.invoice_pdf_url,
        created_at: row.created_at,
      })),
    });
  } catch (error: any) {
    console.error("DASHBOARD SUMMARY ERROR:", error);

    return NextResponse.json(
      { error: error?.message ?? "Dashboard summary failed" },
      { status: 500 }
    );
  }
}
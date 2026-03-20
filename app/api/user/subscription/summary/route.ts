import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummaryView = "full" | "dashboard" | "settings";

type CachedSummary = {
  payload: unknown;
  updatedAt: number;
  inflight: Promise<unknown> | null;
};

const CACHE_TTL_MS = 10_000;
const CACHE_STALE_MS = 30_000;
const summaryCache = new Map<string, CachedSummary>();

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

function toSafeInt(value: unknown): number {
  const parsed = Math.trunc(Number(value ?? 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseView(value: string | null): SummaryView {
  if (value === "dashboard" || value === "settings") return value;
  return "full";
}

function isFresh(entry: CachedSummary) {
  return Date.now() - entry.updatedAt < CACHE_TTL_MS;
}

function isStaleWithinWindow(entry: CachedSummary) {
  return Date.now() - entry.updatedAt < CACHE_STALE_MS;
}

function getCacheKey(companyId: string, view: SummaryView) {
  return `${companyId}:${view}`;
}

async function buildSummaryPayload(owner: Awaited<ReturnType<typeof requireOwnerContext>>, view: SummaryView) {
  if (!owner.ok) {
    throw new Error("UNAUTHORIZED");
  }

  const includeInvoices = view === "full";
  const includeCapacity = view !== "dashboard";
  const includeCompanyProfile = view === "settings";

  const [entitlement, subscriptionStatus] = await Promise.all([
    getCompanyEntitlementSnapshot(owner.supabase, owner.companyId),
    getUnifiedSubscriptionStatus({
      supabase: owner.supabase as any,
      companyId: owner.companyId,
    }),
  ]);

  const currentSubscription = subscriptionStatus.subscription ?? null;
  const subTemplate = (currentSubscription as any)?.subscription_plan_templates || null;

  const structuralAddOnsPromise = includeCapacity
    ? owner.supabase
        .from("company_addon_subscriptions")
        .select("addon_id, quantity, status, add_ons(name, entitlement_key, addon_kind, billing_mode)")
        .eq("company_id", owner.companyId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [], error: null } as any);

  const invoicesPromise = includeInvoices
    ? owner.supabase
        .from("billing_invoices")
        .select(
          "id, invoice_type, status, reference, plan, amount, currency, period_start, period_end, due_at, issued_at, paid_at, invoice_pdf_url, created_at"
        )
        .eq("company_id", owner.companyId)
        .order("created_at", { ascending: false })
        .limit(50)
    : Promise.resolve({ data: [], error: null } as any);

  const companyProfilePromise = includeCompanyProfile
    ? owner.supabase
        .from("companies")
        .select("id, company_name, phone, address, pan, gst_number")
        .eq("id", owner.companyId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null } as any);

  const [structuralResult, invoicesResult, companyProfileResult] = await Promise.all([
    structuralAddOnsPromise,
    invoicesPromise,
    companyProfilePromise,
  ]);

  if (structuralResult.error) {
    throw new Error(structuralResult.error.message);
  }
  if (invoicesResult.error) {
    throw new Error(invoicesResult.error.message);
  }
  if (companyProfileResult.error) {
    throw new Error(companyProfileResult.error.message);
  }

  const codeTypes = ["unit", "box", "carton", "pallet"] as const;
  const quotaTable = codeTypes.map((metric) => {
    const allocated = Math.max(0, Math.trunc(entitlement.limits?.[metric] ?? 0));
    const addonAllocated = Math.max(0, Math.trunc(entitlement.topups?.[metric] ?? 0));
    const subscriptionAllocated = Math.max(0, allocated - addonAllocated);
    const consumed = Math.max(0, Math.trunc(entitlement.usage?.[metric] ?? 0));
    const remaining = Math.max(0, Math.trunc(entitlement.remaining?.[metric] ?? 0));
    return {
      metric,
      allocated,
      subscription_allocated: subscriptionAllocated,
      addon_allocated: addonAllocated,
      consumed,
      remaining,
    };
  });
  const totalQuota = quotaTable.reduce((sum, row) => sum + row.allocated, 0);

  const structuralCapacityRows = ((structuralResult.data as any[]) || []).filter((row: any) => {
    const addon = row.add_ons;
    return addon?.addon_kind === "structural" && addon?.billing_mode === "recurring";
  });

  const addonCapacityByMetric = structuralCapacityRows.reduce<Record<"seat" | "plant" | "handset", number>>(
    (acc, row: any) => {
      const rawKey = String(row?.add_ons?.entitlement_key || "").trim().toLowerCase();
      const quantity = Math.max(0, Math.trunc(Number(row?.quantity || 0)));
      const key =
        rawKey === "seats"
          ? "seat"
          : rawKey === "plants"
            ? "plant"
            : rawKey === "handsets"
              ? "handset"
              : rawKey;
      if (key === "seat" || key === "plant" || key === "handset") {
        acc[key] = (acc[key] || 0) + quantity;
      }
      return acc;
    },
    { seat: 0, plant: 0, handset: 0 }
  );

  const planCapacityByMetric: Record<"seat" | "plant" | "handset", number> = {
    seat: toSafeInt((currentSubscription as any)?.seat_limit),
    plant: toSafeInt((currentSubscription as any)?.plant_limit),
    handset: toSafeInt((currentSubscription as any)?.handset_limit),
  };

  const capacityTypes = ["seat", "plant", "handset"] as const;
  const capacityTable = includeCapacity
    ? capacityTypes.map((metric) => {
        const subscriptionAllocated = planCapacityByMetric[metric];
        const addonAllocated = addonCapacityByMetric[metric] || 0;
        const allocated = Math.max(
          subscriptionAllocated + addonAllocated,
          Math.max(0, Math.trunc(entitlement.limits?.[metric] ?? 0))
        );
        const consumed = Math.max(0, Math.trunc(entitlement.usage?.[metric] ?? 0));
        const remaining = Math.max(0, Math.trunc(entitlement.remaining?.[metric] ?? 0));
        return {
          metric,
          allocated,
          subscription_allocated: subscriptionAllocated,
          addon_allocated: addonAllocated,
          consumed,
          remaining,
        };
      })
    : undefined;

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

  const responseBody: Record<string, unknown> = {
    success: true,
    trial: {
      active: entitlement.trial_active,
      expires_at: entitlement.trial_expires_at,
      days_remaining: entitlement.trial_active ? daysRemaining(entitlement.trial_expires_at) : 0,
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
    decisions,
  };

  if (view === "full") {
    responseBody.company = { id: owner.companyId, name: owner.companyName };
    responseBody.state = entitlement.state;
    responseBody.period = {
      start: entitlement.period_start,
      end: entitlement.period_end,
    };
    responseBody.total_quota = Math.max(0, Math.trunc(totalQuota));
    responseBody.quota_table = quotaTable;
    responseBody.capacity_table = capacityTable;
    responseBody.capacity_addons = structuralCapacityRows.map((row: any) => ({
      addon_id: row.addon_id,
      name: row.add_ons?.name ?? null,
      entitlement_key: row.add_ons?.entitlement_key ?? null,
      quantity: row.quantity,
      status: row.status,
    }));
    responseBody.add_on_balances = {
      unit: entitlement.topups?.unit ?? 0,
      box: entitlement.topups?.box ?? 0,
      carton: entitlement.topups?.carton ?? 0,
      pallet: entitlement.topups?.pallet ?? 0,
    };
    responseBody.invoices = ((invoicesResult.data as any[]) || []).map((row: any) => ({
      ...(() => {
        const rawPdfUrl = String(row.invoice_pdf_url || "").trim();
        const pdfUrl =
          rawPdfUrl && !rawPdfUrl.startsWith("data:application/pdf;base64,")
            ? rawPdfUrl
            : `/api/billing/invoice/${row.id}/pdf`;
        return { invoice_pdf_url: pdfUrl };
      })(),
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
      created_at: row.created_at,
    }));
  } else if (view === "settings") {
    responseBody.capacity_table = capacityTable;
    responseBody.capacity_addons = structuralCapacityRows.map((row: any) => ({
      addon_id: row.addon_id,
      name: row.add_ons?.name ?? null,
      entitlement_key: row.add_ons?.entitlement_key ?? null,
      quantity: row.quantity,
      status: row.status,
    }));
    responseBody.company_profile = companyProfileResult.data ?? null;
  }

  return responseBody;
}

async function computeAndStoreSummary(cacheKey: string, owner: Awaited<ReturnType<typeof requireOwnerContext>>, view: SummaryView) {
  const cacheEntry = summaryCache.get(cacheKey) ?? { payload: null, updatedAt: 0, inflight: null };
  if (cacheEntry.inflight) {
    return cacheEntry.inflight;
  }

  const inflight = buildSummaryPayload(owner, view)
    .then((payload) => {
      cacheEntry.payload = payload;
      cacheEntry.updatedAt = Date.now();
      cacheEntry.inflight = null;
      summaryCache.set(cacheKey, cacheEntry);
      return payload;
    })
    .catch((error) => {
      cacheEntry.inflight = null;
      summaryCache.set(cacheKey, cacheEntry);
      throw error;
    });

  cacheEntry.inflight = inflight;
  summaryCache.set(cacheKey, cacheEntry);
  return inflight;
}

export async function GET(request: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const view = parseView(request.nextUrl.searchParams.get("view"));
    const cacheKey = getCacheKey(owner.companyId, view);
    const existing = summaryCache.get(cacheKey);

    if (existing?.payload && isFresh(existing)) {
      return NextResponse.json(existing.payload);
    }

    if (existing?.payload && isStaleWithinWindow(existing)) {
      computeAndStoreSummary(cacheKey, owner, view).catch(() => undefined);
      return NextResponse.json(existing.payload);
    }

    const payload = await computeAndStoreSummary(cacheKey, owner, view);
    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Dashboard summary failed" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getCompanyEntitlementSnapshot, type EntitlementSnapshot } from "@/lib/entitlement/canonical";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";
import { TRIAL_LIMITS } from "@/lib/trial";

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

function applyTrialLimitFallback(
  entitlement: EntitlementSnapshot,
  hasPaidSubscription: boolean
): EntitlementSnapshot {
  if (!entitlement.trial_active || hasPaidSubscription) {
    return entitlement;
  }

  const metricKeys = Object.keys(TRIAL_LIMITS) as Array<keyof typeof TRIAL_LIMITS>;
  const limits = { ...entitlement.limits };
  const remaining = { ...entitlement.remaining };

  for (const key of metricKeys) {
    const fallbackLimit = Math.max(0, Math.trunc(TRIAL_LIMITS[key] ?? 0));
    const currentLimit = Math.max(0, Math.trunc(entitlement.limits[key] ?? 0));
    const nextLimit = Math.max(currentLimit, fallbackLimit);
    const currentUsage = Math.max(0, Math.trunc(entitlement.usage[key] ?? 0));
    limits[key] = nextLimit;
    remaining[key] = Math.max(
      Math.max(0, Math.trunc(entitlement.remaining[key] ?? 0)),
      Math.max(0, nextLimit - currentUsage)
    );
  }

  return {
    ...entitlement,
    limits,
    remaining,
  };
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

function classifyInvoiceLabel(row: any): string {
  const invoiceType = String(row?.invoice_type || "").trim().toLowerCase();
  if (invoiceType === "subscription") return "Subscription";

  const metadata = row?.metadata as Record<string, any> | null | undefined;
  const addonSnapshot = metadata?.addons_snapshot as Record<string, any> | undefined;
  const capacityCount = Array.isArray(addonSnapshot?.capacity_addons) ? addonSnapshot.capacity_addons.length : 0;
  const codeCount = Array.isArray(addonSnapshot?.code_addons) ? addonSnapshot.code_addons.length : 0;

  if (capacityCount > 0 && codeCount === 0) return "Capacity Add-on";
  if (codeCount > 0 && capacityCount === 0) return "Code Top-Up";
  if (capacityCount > 0 || codeCount > 0) return "Add-on Purchase";
  if (invoiceType === "addon_topup") return "Code Top-Up";
  return "Invoice";
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
  const hasEffectivePaidSubscription =
    subscriptionStatus.source === "subscription" && subscriptionStatus.status === "active";
  const effectiveEntitlement = applyTrialLimitFallback(entitlement, hasEffectivePaidSubscription);
  const subTemplate = (currentSubscription as any)?.subscription_plan_templates || null;
  const nowTs = Date.now();

  const structuralAddOnsPromise = includeCapacity
    ? owner.supabase
        .from("company_addon_subscriptions")
        .select("addon_id, quantity, status, starts_at, ends_at, add_ons(name, entitlement_key, addon_kind, billing_mode, duration_days)")
        .eq("company_id", owner.companyId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [], error: null } as any);

  const invoicesPromise = includeInvoices
    ? owner.supabase
        .from("billing_invoices")
        .select(
          "id, invoice_type, status, reference, plan, amount, currency, period_start, period_end, due_at, issued_at, paid_at, invoice_pdf_url, created_at, metadata"
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
    const allocated = Math.max(0, Math.trunc(effectiveEntitlement.limits?.[metric] ?? 0));
    const addonAllocated = Math.max(0, Math.trunc(effectiveEntitlement.topups?.[metric] ?? 0));
    const subscriptionAllocated = Math.max(0, allocated - addonAllocated);
    const consumed = Math.max(0, Math.trunc(effectiveEntitlement.usage?.[metric] ?? 0));
    const remaining = Math.max(0, Math.trunc(effectiveEntitlement.remaining?.[metric] ?? 0));
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
    const startsAt = row?.starts_at ? Date.parse(String(row.starts_at)) : Number.NEGATIVE_INFINITY;
    const endsAt = row?.ends_at ? Date.parse(String(row.ends_at)) : Number.POSITIVE_INFINITY;
    const activeByDate = startsAt <= nowTs && endsAt > nowTs;
    return addon?.addon_kind === "structural" && addon?.billing_mode === "recurring" && activeByDate;
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
          Math.max(0, Math.trunc(effectiveEntitlement.limits?.[metric] ?? 0))
        );
        const consumed = Math.max(0, Math.trunc(effectiveEntitlement.usage?.[metric] ?? 0));
        const remaining = Math.max(0, Math.trunc(effectiveEntitlement.remaining?.[metric] ?? 0));
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
      if (subscriptionStatus.status === "cancelled" || subscriptionStatus.status === "expired") {
        return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
      }
      if (!hasEffectivePaidSubscription && subscriptionStatus.source !== "trial") {
        return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
      }
      const remaining = quotaTable.reduce((sum, row) => sum + row.remaining, 0);
      if (remaining <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
      return { blocked: false, code: null };
    })(),
    seats: (() => {
      if (!hasEffectivePaidSubscription) {
        return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
      }
      if ((effectiveEntitlement.remaining.seat ?? 0) <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
      return { blocked: false, code: null };
    })(),
    plants: (() => {
      if (!hasEffectivePaidSubscription) {
        return { blocked: true, code: "NO_ACTIVE_SUBSCRIPTION" as const };
      }
      if ((effectiveEntitlement.remaining.plant ?? 0) <= 0) return { blocked: true, code: "QUOTA_EXHAUSTED" as const };
      return { blocked: false, code: null };
    })(),
  };

  const responseBody: Record<string, unknown> = {
    success: true,
    trial: {
      active: effectiveEntitlement.trial_active,
      expires_at: effectiveEntitlement.trial_expires_at,
      days_remaining: effectiveEntitlement.trial_active ? daysRemaining(effectiveEntitlement.trial_expires_at) : 0,
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
      source: subscriptionStatus.source,
      rawStatus: subscriptionStatus.rawStatus ?? null,
      paidThroughPeriodEnd: Boolean(subscriptionStatus.paidThroughPeriodEnd),
      accessEndsAt: subscriptionStatus.accessEndsAt ?? null,
      trialExpiresAt: subscriptionStatus.trialExpiresAt ? subscriptionStatus.trialExpiresAt.toISOString() : null,
    },
    entitlement: effectiveEntitlement,
    decisions,
  };

  if (view === "full") {
    const invoices = ((invoicesResult.data as any[]) || []).map((row: any) => ({
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
      invoice_label: classifyInvoiceLabel(row),
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
    responseBody.company = { id: owner.companyId, name: owner.companyName };
    responseBody.state = effectiveEntitlement.state;
    responseBody.period = {
      start: effectiveEntitlement.period_start,
      end: effectiveEntitlement.period_end,
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
      starts_at: row.starts_at ?? null,
      ends_at: row.ends_at ?? null,
      duration_days: row.add_ons?.duration_days ?? null,
    }));
    responseBody.add_on_balances = {
      unit: effectiveEntitlement.topups?.unit ?? 0,
      box: effectiveEntitlement.topups?.box ?? 0,
      carton: effectiveEntitlement.topups?.carton ?? 0,
      pallet: effectiveEntitlement.topups?.pallet ?? 0,
    };
    responseBody.invoices = invoices;
    responseBody.subscription_invoices = invoices.filter((row) => String((row as any).invoice_type || "").trim().toLowerCase() === "subscription");
    responseBody.addon_invoices = invoices.filter((row) => String((row as any).invoice_type || "").trim().toLowerCase() !== "subscription");
  } else if (view === "settings") {
    responseBody.capacity_table = capacityTable;
    responseBody.capacity_addons = structuralCapacityRows.map((row: any) => ({
      addon_id: row.addon_id,
      name: row.add_ons?.name ?? null,
      entitlement_key: row.add_ons?.entitlement_key ?? null,
      quantity: row.quantity,
      status: row.status,
      starts_at: row.starts_at ?? null,
      ends_at: row.ends_at ?? null,
      duration_days: row.add_ons?.duration_days ?? null,
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
      return apiJson(existing.payload);
    }

    if (existing?.payload && isStaleWithinWindow(existing)) {
      computeAndStoreSummary(cacheKey, owner, view).catch(() => undefined);
      return apiJson(existing.payload);
    }

    const payload = await computeAndStoreSummary(cacheKey, owner, view);
    return apiJson(payload);
  } catch (error: any) {
    return apiJson(
      { error: error?.message ?? "Dashboard summary failed" },
      { status: 500 }
    );
  }
}


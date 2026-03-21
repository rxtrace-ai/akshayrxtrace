import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getStatusView(params: {
  subscription: any | null;
  entitlement: Awaited<ReturnType<typeof getCompanyEntitlementSnapshot>>;
  now: Date;
}) {
  const { subscription, entitlement, now } = params;
  const raw = String(subscription?.status || "").trim().toLowerCase();
  const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
  const inAccessPeriod = Boolean(periodEnd && !Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() > now.getTime());

  const activeSet = new Set(["active", "authenticated", "activated", "charged"]);
  const paymentDueSet = new Set(["past_due", "payment_due", "unpaid"]);
  const cancelledSet = new Set(["cancelled", "canceled"]);

  if (activeSet.has(raw)) {
    return { label: "Active Subscription", code: "active_subscription" as const };
  }
  if (paymentDueSet.has(raw)) {
    return { label: "Payment Due", code: "payment_due" as const };
  }
  if (cancelledSet.has(raw) && inAccessPeriod) {
    return { label: "Active Until End Date", code: "active_until_end_date" as const };
  }
  if (entitlement.trial_active) {
    return { label: "Trial Active", code: "trial_active" as const };
  }
  if (entitlement.trial_expires_at) {
    return { label: "Trial Expired", code: "trial_expired" as const };
  }
  return { label: "No Active Plan", code: "no_active_plan" as const };
}

async function getRecentActivity(supabase: ReturnType<typeof getSupabaseAdmin>, companyId: string) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, status, metadata, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return data ?? [];
}

async function getOverviewStats(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  companyName: string | null;
  includeActivity: boolean;
  debug: boolean;
}) {
  const { supabase, companyId, companyName, includeActivity, debug } = params;
  const now = new Date();

  const [
    entitlement,
    subscriptionResult,
    skusResult,
    scansResult,
    seatsResult,
    handsetsResult,
    unitsResult,
    boxesResult,
    cartonsResult,
    palletsResult,
    recentActivity,
  ] = await Promise.all([
    getCompanyEntitlementSnapshot(supabase, companyId),
    supabase
      .from("company_subscriptions")
      .select(
        "id, status, current_period_start, current_period_end, next_billing_at, start_date, renewal_date, cancel_at_period_end, billing_cycle, subscription_plan_templates(name)"
      )
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("skus").select("id", { count: "exact", head: true }).eq("company_id", companyId).is("deleted_at", null),
    supabase.from("scan_logs").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("seats").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("active", true),
    supabase
      .from("handsets")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
      .is("disabled_at", null),
    supabase.from("labels_units").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("boxes").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("cartons").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("pallets").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    includeActivity ? getRecentActivity(supabase, companyId) : Promise.resolve([]),
  ]);

  if (subscriptionResult.error) throw new Error(subscriptionResult.error.message);
  if (skusResult.error) throw new Error(skusResult.error.message);
  if (scansResult.error) throw new Error(scansResult.error.message);
  if (seatsResult.error) throw new Error(seatsResult.error.message);
  if (handsetsResult.error) throw new Error(handsetsResult.error.message);
  if (unitsResult.error) throw new Error(unitsResult.error.message);
  if (boxesResult.error) throw new Error(boxesResult.error.message);
  if (cartonsResult.error) throw new Error(cartonsResult.error.message);
  if (palletsResult.error) throw new Error(palletsResult.error.message);

  const subscription = subscriptionResult.data || null;
  const statusView = getStatusView({ subscription, entitlement, now });

  const units = toNumber(unitsResult.count);
  const boxes = toNumber(boxesResult.count);
  const cartons = toNumber(cartonsResult.count);
  const pallets = toNumber(palletsResult.count);
  const totalLabelsGenerated = units + boxes + cartons + pallets;
  const totalSsccGenerated = pallets;

  const result = {
    company_id: companyId,
    company_name: companyName,
    subscription: {
      plan_name: String((subscription as any)?.subscription_plan_templates?.name || "No active plan"),
      status: statusView.label,
      status_code: statusView.code,
      is_trial: Boolean(entitlement.trial_active),
      trial_ends_at: entitlement.trial_expires_at,
      subscription_starts_at: (subscription as any)?.start_date || (subscription as any)?.current_period_start || null,
      subscription_ends_at: (subscription as any)?.current_period_end || null,
      renewal_at: (subscription as any)?.renewal_date || (subscription as any)?.next_billing_at || null,
    },
    entitlement: {
      seat_usage: toNumber(entitlement.usage.seat),
      seat_limit: toNumber(entitlement.limits.seat),
      generation_usage_total:
        toNumber(entitlement.usage.unit) +
        toNumber(entitlement.usage.box) +
        toNumber(entitlement.usage.carton) +
        toNumber(entitlement.usage.pallet),
      generation_remaining_total:
        toNumber(entitlement.remaining.unit) +
        toNumber(entitlement.remaining.box) +
        toNumber(entitlement.remaining.carton) +
        toNumber(entitlement.remaining.pallet),
      remaining: entitlement.remaining,
      limits: entitlement.limits,
      state: entitlement.state,
    },
    kpis: {
      total_skus: toNumber(skusResult.count),
      total_handsets: toNumber(handsetsResult.count),
      total_scans: toNumber(scansResult.count),
      total_seats: toNumber(seatsResult.count),
      total_labels_generated: totalLabelsGenerated,
      total_sscc_generated: totalSsccGenerated,
    },
    generation_breakdown: {
      units,
      boxes,
      cartons,
      pallets,
    },
    recent_activity: recentActivity,
  };

  if (debug) {
    console.info("DASHBOARD_OVERVIEW_DEBUG", {
      company_id: companyId,
      subscription_status: result.subscription.status,
      entitlement_state: entitlement.state,
      kpis: result.kpis,
      generation_breakdown: result.generation_breakdown,
    });
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const {
      data: { user },
      error: authError,
    } = await (await supabaseServer()).auth.getUser();

    if (!user || authError) {
      return apiJson({ error: "Not authenticated" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(supabase, user.id, "id, company_name");
    if (!resolved) {
      return apiJson({ error: "Company not found" }, { status: 404 });
    }

    const includeActivity = request.nextUrl.searchParams.get("scope") !== "core";
    const debug =
      request.nextUrl.searchParams.get("debug") === "1" ||
      String(process.env.DASHBOARD_OVERVIEW_DEBUG || "").toLowerCase() === "true";

    const stats = await getOverviewStats({
      supabase,
      companyId: resolved.companyId,
      companyName: (resolved.company?.company_name as string) ?? null,
      includeActivity,
      debug,
    });

    return apiJson(stats);
  } catch (err: any) {
    return apiJson({ error: err?.message || String(err) }, { status: 500 });
  }
}



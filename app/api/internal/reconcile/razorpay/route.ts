import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { logError, logInfo } from "@/lib/observability";
import {
  fetchRazorpaySubscription,
  mapRazorpaySubscriptionStatusToLocal,
  toIsoFromUnix,
} from "@/lib/billing/razorpaySubscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireInternalAuth(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_RECONCILE_SECRET?.trim();
  if (!expected) return false;
  const provided = req.headers.get("x-internal-secret")?.trim() || "";
  return provided.length > 0 && provided === expected;
}

export async function POST(req: NextRequest) {
  const correlationId = getOrGenerateCorrelationId(req.headers, "internal");
  if (!requireInternalAuth(req)) {
    return apiJson({ error: "Forbidden", correlation_id: correlationId }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  const { data: subscriptions, error } = await supabase
    .from("company_subscriptions")
    .select(
      "id, company_id, status, provider_subscription_id, razorpay_subscription_id, provider_customer_id, current_period_start, current_period_end, next_billing_at, cancel_at_period_end, updated_at"
    )
    .in("status", ["active", "pending", "pending_payment"])
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    logError("RAZORPAY_RECONCILE_LOAD_FAILED", {
      operation: "razorpay_reconcile",
      correlationId,
      error: error.message,
    });
    return apiJson({ error: error.message, correlation_id: correlationId }, { status: 500 });
  }

  const rows = (subscriptions || []) as any[];
  const repaired: Array<Record<string, unknown>> = [];
  const missingProvider: Array<Record<string, unknown>> = [];
  const unchanged: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const providerSubscriptionId =
      String(row.provider_subscription_id || "").trim() || String(row.razorpay_subscription_id || "").trim();

    if (!providerSubscriptionId) {
      missingProvider.push({
        company_id: row.company_id,
        subscription_id: row.id,
        status: row.status,
      });
      continue;
    }

    try {
      const provider = await fetchRazorpaySubscription(providerSubscriptionId);
      const nextStatus = mapRazorpaySubscriptionStatusToLocal(provider?.status);
      const currentPeriodStart = toIsoFromUnix(provider?.current_start);
      const currentPeriodEnd = toIsoFromUnix(provider?.current_end);
      const nextBillingAt = toIsoFromUnix(provider?.charge_at);
      const nextCustomerId = String(provider?.customer_id || "").trim() || null;

      const changed =
        nextStatus !== String(row.status || "").trim().toLowerCase() ||
        currentPeriodStart !== (row.current_period_start ?? null) ||
        currentPeriodEnd !== (row.current_period_end ?? null) ||
        nextBillingAt !== (row.next_billing_at ?? null) ||
        nextCustomerId !== (row.provider_customer_id ?? null);

      if (!changed) {
        unchanged.push({
          company_id: row.company_id,
          provider_subscription_id: providerSubscriptionId,
          status: nextStatus,
        });
        continue;
      }

      const { error: updateError } = await supabase
        .from("company_subscriptions")
        .update({
          status: nextStatus,
          provider: "razorpay",
          provider_subscription_id: providerSubscriptionId,
          razorpay_subscription_id: providerSubscriptionId,
          provider_customer_id: nextCustomerId,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          next_billing_at: nextBillingAt,
          cancel_at_period_end: row.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) {
        failures.push({
          company_id: row.company_id,
          provider_subscription_id: providerSubscriptionId,
          error: updateError.message,
        });
        continue;
      }

      repaired.push({
        company_id: row.company_id,
        provider_subscription_id: providerSubscriptionId,
        previous_status: row.status,
        status: nextStatus,
      });
    } catch (providerError: any) {
      failures.push({
        company_id: row.company_id,
        provider_subscription_id: providerSubscriptionId,
        error: String(providerError?.message || "UNKNOWN_PROVIDER_FETCH_ERROR"),
      });
    }
  }

  logInfo("RAZORPAY_RECONCILE_COMPLETED", {
    operation: "razorpay_reconcile",
    correlationId,
    checked: rows.length,
    repaired_count: repaired.length,
    unchanged_count: unchanged.length,
    missing_provider_count: missingProvider.length,
    failure_count: failures.length,
  });

  return apiJson({
    success: true,
    correlation_id: correlationId,
    checked: rows.length,
    repaired_count: repaired.length,
    unchanged_count: unchanged.length,
    missing_provider_count: missingProvider.length,
    failure_count: failures.length,
    repaired,
    missing_provider: missingProvider,
    failures,
  });
}



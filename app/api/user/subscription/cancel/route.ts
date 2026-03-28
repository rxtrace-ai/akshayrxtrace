import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { checkUserIdempotency, hashRequestBody, storeUserIdempotencyResponse } from "@/lib/user/idempotency";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/config";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";
import {
  cancelRazorpaySubscription,
  mapRazorpaySubscriptionStatusToLocal,
  toIsoFromUnix,
} from "@/lib/billing/razorpaySubscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeIdempotencyKey(req: NextRequest, body: any): string {
  return String(body?.idempotency_key || req.headers.get("idempotency-key") || "").trim();
}

function formatDateForEmail(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => ({}));
  const correlationId = getOrGenerateCorrelationId(await headers(), "user");
  const idempotencyKey = normalizeIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return apiJson({ error: "Missing Idempotency-Key header" }, { status: 400 });
  }

  const requestHash = hashRequestBody(body);
  const idem = await checkUserIdempotency({
    supabase: owner.supabase,
    userId: owner.userId,
    endpoint: "/api/user/subscription/cancel",
    idempotencyKey,
    requestHash,
  });
  if (idem.kind === "missing_key") return apiJson({ error: "Missing Idempotency-Key header" }, { status: 400 });
  if (idem.kind === "conflict") return apiJson({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  if (idem.kind === "replay") return apiJson(idem.payload, { status: idem.statusCode });

  const cancelAtPeriodEnd = (body as any)?.cancel_at_period_end !== false;
  const now = new Date().toISOString();
  const { data: currentSubscription, error: readError } = await owner.supabase
    .from("company_subscriptions")
    .select(
      "id, status, cancel_at_period_end, current_period_start, current_period_end, next_billing_at, renewal_date, provider_subscription_id, razorpay_subscription_id, metadata"
    )
    .eq("company_id", owner.companyId)
    .in("status", ["active", "pending", "pending_payment"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError) {
    return apiJson({ error: readError.message }, { status: 500 });
  }
  if (!currentSubscription) {
    return apiJson({ error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 409 });
  }

  const providerSubscriptionId =
    String((currentSubscription as any).provider_subscription_id || "").trim() ||
    String((currentSubscription as any).razorpay_subscription_id || "").trim();
  if (!providerSubscriptionId) {
    return apiJson({ error: "PROVIDER_SUBSCRIPTION_ID_MISSING" }, { status: 409 });
  }

  const providerSubscription = await cancelRazorpaySubscription({
    subscriptionId: providerSubscriptionId,
    cancelAtCycleEnd: cancelAtPeriodEnd,
  });

  const nextStatus = mapRazorpaySubscriptionStatusToLocal(providerSubscription?.status);
  const currentPeriodStart = toIsoFromUnix(providerSubscription?.current_start) ?? (currentSubscription as any).current_period_start ?? null;
  const currentPeriodEnd = toIsoFromUnix(providerSubscription?.current_end) ?? (currentSubscription as any).current_period_end ?? null;
  const nextBillingAt = toIsoFromUnix(providerSubscription?.charge_at) ?? currentPeriodEnd;

  const { data: updated, error } = await owner.supabase
    .from("company_subscriptions")
    .update({
      status: nextStatus,
      cancel_at_period_end: cancelAtPeriodEnd,
      provider: "razorpay",
      provider_subscription_id: providerSubscriptionId,
      razorpay_subscription_id: providerSubscriptionId,
      provider_customer_id: String(providerSubscription?.customer_id || "").trim() || null,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      next_billing_at: cancelAtPeriodEnd ? nextBillingAt : null,
      renewal_date: cancelAtPeriodEnd ? currentPeriodEnd : null,
      metadata: {
        ...(((currentSubscription as any).metadata || {}) as Record<string, unknown>),
        provider_cancelled_at: now,
        provider_cancel_at_period_end: cancelAtPeriodEnd,
        provider_cancel_correlation_id: correlationId,
      },
      updated_at: now,
    })
    .eq("id", (currentSubscription as any).id)
    .select("status, cancel_at_period_end, current_period_end, next_billing_at")
    .maybeSingle();

  if (error) {
    return apiJson({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return apiJson({ error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 409 });
  }

  const payload = {
    success: true,
    subscription: {
      status: (updated as any).status,
      cancel_at_period_end: (updated as any).cancel_at_period_end,
      current_period_end: (updated as any).current_period_end ?? null,
      next_billing_at: (updated as any).next_billing_at ?? null,
    },
    correlation_id: correlationId,
  };

  try {
    const admin = getSupabaseAdmin();
    const ownerResult = await admin.auth.admin.getUserById(owner.userId);
    const ownerEmail = String(ownerResult?.data?.user?.email || "").trim();
    const ownerName = String((ownerResult?.data?.user?.user_metadata as any)?.full_name || "").trim() || "there";
    const currentPeriodEnd = String((updated as any).current_period_end || "").trim();

    if (ownerEmail && currentPeriodEnd) {
      await sendTransactionalEmail({
        to: ownerEmail,
        event: "SUBSCRIPTION_CANCELLED",
        payload: {
          user_name: ownerName,
          expiry_date: formatDateForEmail(currentPeriodEnd),
          renew_link: `${getAppUrl()}/dashboard/subscription`,
        },
      });
    }
  } catch (emailError) {
    console.error("SUBSCRIPTION_CANCEL_EMAIL_FAILED", {
      correlationId,
      companyId: owner.companyId,
      userId: owner.userId,
      error: String((emailError as any)?.message || "UNKNOWN"),
    });
  }

  await storeUserIdempotencyResponse({
    supabase: owner.supabase,
    userId: owner.userId,
    endpoint: "/api/user/subscription/cancel",
    idempotencyKey: (idem as any).key ?? idempotencyKey,
    requestHash,
    statusCode: 200,
    payload,
    correlationId,
  });

  return apiJson(payload, { status: 200 });
}


import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { checkUserIdempotency, hashRequestBody, storeUserIdempotencyResponse } from "@/lib/user/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientLegStatus = "created" | "initiated" | "paid" | "failed" | "cancelled";

function normalizeLegStatus(value: unknown): ClientLegStatus {
  const parsed = String(value || "").trim().toLowerCase();
  if (parsed === "paid") return "paid";
  if (parsed === "failed") return "failed";
  if (parsed === "cancelled") return "cancelled";
  if (parsed === "initiated") return "initiated";
  return "created";
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const body = await req.json().catch(() => ({}));
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const idempotencyKey = String((body as any)?.idempotency_key || req.headers.get("idempotency-key") || "").trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
    }
    const requestHash = hashRequestBody(body);
    const idem = await checkUserIdempotency({
      supabase: owner.supabase,
      userId: owner.userId,
      endpoint: "/api/user/subscription/checkout/confirm-client",
      idempotencyKey,
      requestHash,
    });
    if (idem.kind === "missing_key") return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
    if (idem.kind === "conflict") return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (idem.kind === "replay") return NextResponse.json(idem.payload, { status: idem.statusCode });

    const checkoutSessionId = String((body as any)?.checkout_session_id || "").trim();
    if (!checkoutSessionId) {
      return NextResponse.json({ error: "checkout_session_id is required" }, { status: 400 });
    }

    const { data: session, error: sessionError } = await owner.supabase
      .from("checkout_sessions")
      .select("id, company_id, owner_user_id, status, topup_payload_json, metadata")
      .eq("id", checkoutSessionId)
      .eq("company_id", owner.companyId)
      .eq("owner_user_id", owner.userId)
      .maybeSingle();
    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
    if (!session) return NextResponse.json({ error: "CHECKOUT_SESSION_NOT_FOUND" }, { status: 404 });

    const subscriptionLeg = (body as any)?.subscription || {};
    const topupLeg = (body as any)?.topup || {};
    const subStatus = normalizeLegStatus(subscriptionLeg.status);
    const topupStatus = normalizeLegStatus(topupLeg.status);
    const hasTopup = Boolean((session as any).topup_payload_json);

    let nextStatus: string = String((session as any).status || "created");
    if (subStatus === "paid" && hasTopup && topupStatus === "paid") {
      nextStatus = "topup_paid";
    } else if (subStatus === "paid" && hasTopup && topupStatus !== "paid") {
      nextStatus = "partial_success";
    } else if (subStatus === "paid" && !hasTopup) {
      nextStatus = "subscription_paid";
    } else if (subStatus === "failed") {
      nextStatus = "failed";
    }

    const metadata = {
      ...((session as any).metadata || {}),
      client_confirmation: {
        confirmed_at: new Date().toISOString(),
        subscription: {
          status: subStatus,
          razorpay_subscription_id: subscriptionLeg.razorpay_subscription_id || null,
          razorpay_payment_id: subscriptionLeg.razorpay_payment_id || null,
          razorpay_signature: subscriptionLeg.razorpay_signature || null,
        },
        topup: {
          status: topupStatus,
          razorpay_order_id: topupLeg.razorpay_order_id || null,
          razorpay_payment_id: topupLeg.razorpay_payment_id || null,
          razorpay_signature: topupLeg.razorpay_signature || null,
        },
      },
    };

    const updates: Record<string, unknown> = {
      status: nextStatus,
      metadata,
      updated_at: new Date().toISOString(),
    };
    if (subscriptionLeg.razorpay_subscription_id) {
      updates.provider_subscription_id = String(subscriptionLeg.razorpay_subscription_id);
    }
    if (topupLeg.razorpay_order_id) {
      updates.provider_topup_order_id = String(topupLeg.razorpay_order_id);
    }

    const { data: updated, error: updateError } = await owner.supabase
      .from("checkout_sessions")
      .update(updates)
      .eq("id", checkoutSessionId)
      .select("id, status, provider_subscription_id, provider_topup_order_id")
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const payload = {
      success: true,
      checkout_session_id: (updated as any).id,
      status: (updated as any).status,
      provider_subscription_id: (updated as any).provider_subscription_id || null,
      provider_topup_order_id: (updated as any).provider_topup_order_id || null,
      webhook_activation_pending: true,
      correlation_id: correlationId,
    };

    await storeUserIdempotencyResponse({
      supabase: owner.supabase,
      userId: owner.userId,
      endpoint: "/api/user/subscription/checkout/confirm-client",
      idempotencyKey: (idem as any).key ?? idempotencyKey,
      requestHash,
      statusCode: 200,
      payload,
      correlationId,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to confirm checkout callback" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Razorpay from "razorpay";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DEFAULT_RAZORPAY_PLAN_ID = "plan_SS7ZgGfy9sKS2q";

function getRazorpayClient(keyId: string, keySecret: string) {
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

const ALLOWED_PENDING_STATUSES = new Set([
  "created",
  "quote_locked",
  "subscription_initiated",
  "subscription_paid",
  "topup_initiated",
  "topup_paid",
  "partial_success",
  "failed",
  "expired",
  "cancelled",
]);

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const body = await req.json().catch(() => ({}));
    const checkoutSessionId = String((body as any)?.checkout_session_id || "").trim();
    if (!checkoutSessionId) {
      return NextResponse.json({ error: "checkout_session_id is required" }, { status: 400 });
    }

    const { data: session, error: sessionError } = await owner.supabase
      .from("checkout_sessions")
      .select(
        "id, company_id, owner_user_id, status, expires_at, provider_subscription_id, quote_payload_json, totals_json, selected_plan_template_id, selected_plan_version_id, metadata"
      )
      .eq("id", checkoutSessionId)
      .eq("company_id", owner.companyId)
      .eq("owner_user_id", owner.userId)
      .maybeSingle();

    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
    if (!session) return NextResponse.json({ error: "CHECKOUT_SESSION_NOT_FOUND" }, { status: 404 });

    const sessionStatus = normalizeStatus((session as any).status);
    if (sessionStatus === "completed") {
      return NextResponse.json({ error: "CHECKOUT_SESSION_ALREADY_COMPLETED" }, { status: 409 });
    }
    if (!ALLOWED_PENDING_STATUSES.has(sessionStatus)) {
      return NextResponse.json({ error: "CHECKOUT_SESSION_NOT_PAYABLE" }, { status: 409 });
    }

    const expiresAtMs = new Date(String((session as any).expires_at || "")).getTime();
    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      await owner.supabase
        .from("checkout_sessions")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", checkoutSessionId);
      return NextResponse.json({ error: "CHECKOUT_SESSION_EXPIRED" }, { status: 409 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
    }
    console.log("KEY:", keyId);
    console.log("RAZORPAY MODE:", keyId.startsWith("rzp_live_") ? "live" : "test");

    const { data: selectedTemplate, error: selectedTemplateError } = await owner.supabase
      .from("subscription_plan_templates")
      .select("id, razorpay_plan_id")
      .eq("id", String((session as any).selected_plan_template_id || ""))
      .maybeSingle();
    if (selectedTemplateError) {
      return NextResponse.json({ error: selectedTemplateError.message }, { status: 500 });
    }

    if (!(selectedTemplate as any)?.razorpay_plan_id) {
      console.error("Missing razorpay_plan_id", {
        checkout_session_id: checkoutSessionId,
        selected_plan_template_id: (session as any).selected_plan_template_id,
      });
    }
    const planId = String((selectedTemplate as any)?.razorpay_plan_id || DEFAULT_RAZORPAY_PLAN_ID).trim();
    if (!planId) {
      return NextResponse.json({ error: "Missing razorpay_plan_id" }, { status: 409 });
    }
    console.log("PLAN ID SENT:", planId);
    if (!keyId.startsWith("rzp_live_")) {
      console.warn("RAZORPAY MODE MISMATCH: non-live key detected while using live plan fallback", {
        key: keyId,
        plan_id: planId,
      });
    }

    const existingSubscriptionId = String((session as any).provider_subscription_id || "").trim();
    if (existingSubscriptionId) {
      return NextResponse.json({
        success: true,
        replay: true,
        subscription_id: existingSubscriptionId,
        plan_id_used: planId,
        correlation_id: correlationId,
        checkout_session: {
          id: (session as any).id,
          status: (session as any).status,
          selected_plan_template_id: (session as any).selected_plan_template_id,
          selected_plan_version_id: (session as any).selected_plan_version_id,
          quote: (session as any).quote_payload_json,
          totals: (session as any).totals_json,
        },
        razorpay: {
          key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
          subscription_id: existingSubscriptionId,
          plan_id_used: planId,
          currency: "INR",
        },
      });
    }

    try {
      const razorpay = getRazorpayClient(keyId, keySecret);
      const created = await razorpay.subscriptions.create({
        plan_id: planId,
        customer_notify: 1,
        total_count: 12,
        notes: {
          purpose: "subscription_checkout",
          checkout_session_id: checkoutSessionId,
          company_id: owner.companyId,
          owner_user_id: owner.userId,
          correlation_id: correlationId,
        },
      });

      const subscriptionId = String(created?.id || "").trim();
      if (!subscriptionId) {
        return NextResponse.json(
          {
            error: "RAZORPAY_SUBSCRIPTION_CREATE_FAILED",
            detail: "Missing subscription id",
            plan_id_used: planId,
            correlation_id: correlationId,
          },
          { status: 502 }
        );
      }

      const now = new Date().toISOString();
      const { error: updateSessionError } = await owner.supabase
        .from("checkout_sessions")
        .update({
          provider_subscription_id: subscriptionId,
          status: "subscription_initiated",
          metadata: {
            ...((session as any).metadata || {}),
            phase: "phase_3_payment_initiated",
            provider: "razorpay",
            payment_subscription_created_at: now,
            payment_subscription_id: subscriptionId,
            razorpay_plan_id: planId,
          },
          updated_at: now,
        })
        .eq("id", checkoutSessionId)
        .eq("company_id", owner.companyId)
        .in("status", Array.from(ALLOWED_PENDING_STATUSES));

      if (updateSessionError) {
        return NextResponse.json({ error: updateSessionError.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        subscription_id: subscriptionId,
        plan_id_used: planId,
        correlation_id: correlationId,
        checkout_session: {
          id: (session as any).id,
          status: "subscription_initiated",
          selected_plan_template_id: (session as any).selected_plan_template_id,
          selected_plan_version_id: (session as any).selected_plan_version_id,
          quote: (session as any).quote_payload_json,
          totals: (session as any).totals_json,
        },
        razorpay: {
          key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
          subscription_id: subscriptionId,
          plan_id_used: planId,
          currency: "INR",
        },
      });
    } catch (error: any) {
      console.error("RAZORPAY ERROR:", {
        plan_id_used: planId,
        key: keyId,
        message: error?.message || String(error),
        statusCode: error?.statusCode ?? null,
        error: error?.error ?? null,
        description: error?.error?.description ?? null,
      });
      return NextResponse.json(
        {
          error: "RAZORPAY_SUBSCRIPTION_CREATE_FAILED",
          detail: error?.error?.description || error?.message || "Failed to create Razorpay subscription",
          plan_id_used: planId,
          key_used: keyId,
          correlation_id: correlationId,
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to initiate Razorpay checkout payment" },
      { status: 500 }
    );
  }
}

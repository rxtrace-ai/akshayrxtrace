import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import {
  checkoutQuoteHash,
  verifyCheckoutQuoteSignature,
  type CheckoutQuotePayload,
} from "@/lib/billing/userCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeIdempotencyKey(value: unknown): string {
  return String(value || "").trim();
}

function isExpired(expiresAt: string): boolean {
  const ts = new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() > ts;
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const body = await req.json().catch(() => ({}));
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const headerKey = req.headers.get("idempotency-key");
    const idempotencyKey = normalizeIdempotencyKey((body as any)?.idempotency_key || headerKey);

    if (!idempotencyKey) {
      return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
    }

    const quote = ((body as any)?.quote || null) as CheckoutQuotePayload | null;
    const quoteSignature = String((body as any)?.quote_signature || "").trim();
    const providedQuoteHash = quote ? checkoutQuoteHash(quote) : null;

    const { data: existingSession, error: existingError } = await owner.supabase
      .from("checkout_sessions")
      .select(
        "id, quote_hash, status, selected_plan_template_id, selected_plan_version_id, totals_json, expires_at, provider_subscription_id, provider_topup_order_id, subscription_payload_json, topup_payload_json"
      )
      .eq("company_id", owner.companyId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    if (existingSession) {
      if (providedQuoteHash && String((existingSession as any).quote_hash || "") !== providedQuoteHash) {
        return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
      }
      return NextResponse.json({
        success: true,
        replay: true,
        checkout_session_id: (existingSession as any).id,
        status: (existingSession as any).status,
        correlation_id: correlationId,
        checkout: {
          subscription: (existingSession as any).subscription_payload_json || null,
          topup: (existingSession as any).topup_payload_json || null,
        },
      });
    }

    if (!quote || !quoteSignature) {
      return NextResponse.json({ error: "quote and quote_signature are required" }, { status: 400 });
    }
    if (!verifyCheckoutQuoteSignature(quote, quoteSignature)) {
      return NextResponse.json({ error: "INVALID_QUOTE_SIGNATURE" }, { status: 400 });
    }
    if (isExpired(quote.expires_at)) {
      return NextResponse.json({ error: "QUOTE_EXPIRED" }, { status: 409 });
    }
    if (quote.company_id !== owner.companyId || quote.owner_user_id !== owner.userId) {
      return NextResponse.json({ error: "QUOTE_COMPANY_MISMATCH" }, { status: 403 });
    }

    const quoteHash = checkoutQuoteHash(quote);

    const { data: selectedTemplate, error: templateError } = await owner.supabase
      .from("subscription_plan_templates")
      .select("id, name, razorpay_plan_id, billing_cycle, amount_from_razorpay, is_active")
      .eq("id", quote.selected_plan_template_id)
      .eq("is_active", true)
      .maybeSingle();
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
    if (!selectedTemplate) return NextResponse.json({ error: "PLAN_NOT_AVAILABLE" }, { status: 409 });

    const { data: selectedVersion, error: versionError } = await owner.supabase
      .from("subscription_plan_versions")
      .select("id, version_number, is_active")
      .eq("id", quote.selected_plan_version_id)
      .eq("template_id", quote.selected_plan_template_id)
      .eq("is_active", true)
      .maybeSingle();
    if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });
    if (!selectedVersion) return NextResponse.json({ error: "PLAN_VERSION_NOT_AVAILABLE" }, { status: 409 });

    const subscriptionPayload = {
      mode: "subscription",
      provider: "razorpay",
      action: "create_subscription",
      plan_name: (selectedTemplate as any).name,
      billing_cycle: (selectedTemplate as any).billing_cycle,
      amount_paise: (selectedTemplate as any).amount_from_razorpay,
      razorpay_plan_id: (selectedTemplate as any).razorpay_plan_id,
      coupon_offer_id: quote.coupon?.razorpay_offer_id || null,
    };

    const hasTopup = Array.isArray(quote.variable_topups) && quote.variable_topups.length > 0;
    const topupPayload = hasTopup
      ? {
          mode: "one_time_topup",
          provider: "razorpay",
          action: "create_order",
          currency: "INR",
          amount_paise: quote.totals.variable_topups_paise,
          lines: quote.variable_topups,
        }
      : null;

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await owner.supabase
      .from("checkout_sessions")
      .insert({
        company_id: owner.companyId,
        owner_user_id: owner.userId,
        idempotency_key: idempotencyKey,
        quote_hash: quoteHash,
        quote_payload_json: quote,
        status: "subscription_initiated",
        selected_plan_template_id: quote.selected_plan_template_id,
        selected_plan_version_id: quote.selected_plan_version_id,
        coupon_code: quote.coupon?.code || null,
        coupon_id: quote.coupon?.id || null,
        coupon_snapshot_json: quote.coupon || null,
        subscription_payload_json: subscriptionPayload,
        topup_payload_json: topupPayload,
        totals_json: quote.totals,
        expires_at: quote.expires_at,
        correlation_id: correlationId,
        metadata: {
          initiated_by: owner.userId,
          initiated_at: now,
          has_variable_topup: hasTopup,
        },
      })
      .select("id, status, expires_at")
      .single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      checkout_session_id: (inserted as any).id,
      status: (inserted as any).status,
      expires_at: (inserted as any).expires_at,
      correlation_id: correlationId,
      checkout: {
        subscription: subscriptionPayload,
        topup: topupPayload,
      },
      webhook_activation_pending: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to initiate checkout session" },
      { status: 500 }
    );
  }
}

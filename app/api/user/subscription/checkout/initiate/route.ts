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

function normalizeStatus(value: unknown): string {
  const parsed = String(value || "").trim().toLowerCase();
  if (["active", "authenticated", "activated", "charged"].includes(parsed)) return "active";
  if (["cancelled", "canceled"].includes(parsed)) return "cancelled";
  if (["pending", "trial", "trialing"].includes(parsed)) return "pending";
  return "expired";
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
        "id, quote_hash, status, selected_plan_template_id, selected_plan_version_id, totals_json, expires_at, subscription_payload_json, topup_payload_json"
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
          add_ons: (existingSession as any).topup_payload_json || null,
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
      .select("*")
      .eq("id", quote.selected_plan_template_id)
      .eq("is_active", true)
      .maybeSingle();
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
    if (!selectedTemplate) return NextResponse.json({ error: "PLAN_NOT_AVAILABLE" }, { status: 409 });

    const { data: selectedVersion, error: versionError } = await owner.supabase
      .from("subscription_plan_versions")
      .select("*")
      .eq("id", quote.selected_plan_version_id)
      .eq("template_id", quote.selected_plan_template_id)
      .eq("is_active", true)
      .maybeSingle();
    if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });
    if (!selectedVersion) return NextResponse.json({ error: "PLAN_VERSION_NOT_AVAILABLE" }, { status: 409 });

    const subscriptionPayload = {
      mode: "subscription",
      action: "payment_pending",
      plan_name: quote.plan.name,
      description: quote.plan.description,
      billing_cycle: quote.plan.billing_cycle,
      plan_price_paise: quote.plan.plan_price_paise,
      pricing_unit_size: quote.plan.pricing_unit_size,
      quotas: quote.plan.quotas,
      capacities: quote.plan.capacities,
    };

    const addOnPayload =
      quote.capacity_addons.length || quote.code_addons.length
        ? {
            mode: "add_ons",
            action: "payment_pending",
            coupon: quote.coupon,
            discount_paise: quote.totals.discount_paise,
            payable_paise: quote.totals.addons_payable_paise,
            capacity_addons: quote.capacity_addons,
            code_addons: quote.code_addons,
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
        status: "quote_locked",
        selected_plan_template_id: quote.selected_plan_template_id,
        selected_plan_version_id: quote.selected_plan_version_id,
        coupon_code: quote.coupon?.code ?? null,
        coupon_id: quote.coupon?.id ?? null,
        coupon_snapshot_json: quote.coupon,
        subscription_payload_json: subscriptionPayload,
        topup_payload_json: addOnPayload,
        totals_json: quote.totals,
        expires_at: quote.expires_at,
        correlation_id: correlationId,
        metadata: {
          initiated_by: owner.userId,
          initiated_at: now,
          phase: "phase_3_checkout_pending_payment",
        },
      })
      .select("id, status, expires_at")
      .single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    const { data: latestSubscription, error: subReadError } = await owner.supabase
      .from("company_subscriptions")
      .select("id, status")
      .eq("company_id", owner.companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subReadError) return NextResponse.json({ error: subReadError.message }, { status: 500 });

    const pendingSnapshot = {
      company_id: owner.companyId,
      status: "pending",
      plan_template_id: quote.selected_plan_template_id,
      plan_version_id: quote.selected_plan_version_id,
      billing_cycle: quote.plan.billing_cycle,
      start_date: now,
      renewal_date: null,
      unit_subscription_quota: quote.plan.quotas.unit,
      box_subscription_quota: quote.plan.quotas.box,
      carton_subscription_quota: quote.plan.quotas.carton,
      pallet_subscription_quota: quote.plan.quotas.pallet,
      seat_limit: quote.plan.capacities.seat,
      plant_limit: quote.plan.capacities.plant,
      handset_limit: quote.plan.capacities.handset,
      metadata: {
        pending_checkout_session_id: (inserted as any).id,
        updated_from_phase_2_checkout: now,
      },
      updated_at: now,
    };

    if (!latestSubscription) {
      const { error: subInsertError } = await owner.supabase
        .from("company_subscriptions")
        .insert(pendingSnapshot);
      if (subInsertError) return NextResponse.json({ error: subInsertError.message }, { status: 500 });
    } else if (normalizeStatus((latestSubscription as any).status) !== "active") {
      const { error: subUpdateError } = await owner.supabase
        .from("company_subscriptions")
        .update(pendingSnapshot)
        .eq("id", (latestSubscription as any).id);
      if (subUpdateError) return NextResponse.json({ error: subUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      checkout_session_id: (inserted as any).id,
      status: (inserted as any).status,
      expires_at: (inserted as any).expires_at,
      correlation_id: correlationId,
      checkout: {
        subscription: subscriptionPayload,
        add_ons: addOnPayload,
      },
      payment_required_in_phase_3: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to initiate checkout session" },
      { status: 500 }
    );
  }
}

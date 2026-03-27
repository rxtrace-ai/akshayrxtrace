import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { headers } from "next/headers";
import Razorpay from "razorpay";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import {
  createRazorpaySubscription,
  getRazorpayPublishableKey,
  getRazorpaySubscriptionTotalCount,
} from "@/lib/billing/razorpaySubscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRazorpayClient(keyId: string, keySecret: string) {
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function toPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const body = await req.json().catch(() => ({}));
    const quoteId = String((body as any)?.quote_id || "").trim();
    if (!quoteId) {
      return apiJson({ error: "quote_id is required" }, { status: 400 });
    }

    const { data: quote, error: quoteError } = await owner.supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .eq("company_id", owner.companyId)
      .eq("user_id", owner.userId)
      .maybeSingle();
    if (quoteError) return apiJson({ error: quoteError.message }, { status: 500 });
    if (!quote) return apiJson({ error: "QUOTE_NOT_FOUND" }, { status: 404 });

    const quoteStatus = String((quote as any).status || "").trim().toLowerCase();
    if (quoteStatus !== "active") {
      return apiJson({ error: "QUOTE_NOT_ACTIVE" }, { status: 409 });
    }

    const expiresAt = new Date(String((quote as any).expires_at || "")).getTime();
    if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
      await owner.supabase.from("quotes").update({ status: "expired" }).eq("id", quoteId);
      return apiJson({ error: "QUOTE_EXPIRED" }, { status: 409 });
    }

    const totalsSnapshot = ((quote as any).totals_snapshot_json || {}) as Record<string, unknown>;
    const planSnapshot = ((quote as any).plan_snapshot_json || {}) as Record<string, unknown>;
    const addonsSnapshot = ((quote as any).addons_json || {}) as Record<string, unknown>;
    const hasPlan = Object.keys(planSnapshot).length > 0;
    const checkoutMode = hasPlan ? "recurring_plan" : "one_time_addon";
    const finalAmountPaise = toPaise(totalsSnapshot.final_total_paise);
    if (!finalAmountPaise) {
      return apiJson({ error: "QUOTE_FINAL_TOTAL_MISSING" }, { status: 409 });
    }
    if (finalAmountPaise <= 0) {
      return apiJson({ error: "FINAL_TOTAL_MUST_BE_GREATER_THAN_ZERO" }, { status: 400 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      return apiJson({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
    }

    const { data: existingIntent, error: intentReadError } = await owner.supabase
      .from("payment_intents")
      .select("*")
      .eq("quote_id", quoteId)
      .maybeSingle();
    if (intentReadError) return apiJson({ error: intentReadError.message }, { status: 500 });

    if (checkoutMode === "recurring_plan" && existingIntent && String((existingIntent as any).provider_subscription_id || "").trim()) {
      return apiJson({
        success: true,
        replay: true,
        quote_id: quoteId,
        payment_intent_id: (existingIntent as any).id,
        subscription_id: (existingIntent as any).provider_subscription_id,
        correlation_id: correlationId,
        checkout_mode: checkoutMode,
        razorpay: {
          key_id: getRazorpayPublishableKey(),
          subscription_id: (existingIntent as any).provider_subscription_id,
          amount_paise: finalAmountPaise,
          currency: String((quote as any).currency || "INR"),
        },
      });
    }

    if (
      checkoutMode === "recurring_plan" &&
      existingIntent &&
      String((existingIntent as any).razorpay_order_id || "").trim() &&
      !String((existingIntent as any).provider_subscription_id || "").trim()
    ) {
      return apiJson(
        {
          error: "LEGACY_RECURRING_PAYMENT_INTENT_CONFLICT",
          message:
            "This quote already has a legacy order-based payment intent. Generate a fresh quote before starting recurring subscription checkout.",
          checkout_mode: checkoutMode,
        },
        { status: 409 }
      );
    }

    if (checkoutMode === "one_time_addon" && existingIntent && String((existingIntent as any).razorpay_order_id || "").trim()) {
      await owner.supabase
        .from("quotes")
        .update({ status: "pending_payment" })
        .eq("id", quoteId)
        .eq("status", "active");
      return apiJson({
        success: true,
        replay: true,
        quote_id: quoteId,
        payment_intent_id: (existingIntent as any).id,
        order_id: (existingIntent as any).razorpay_order_id,
        correlation_id: correlationId,
        razorpay: {
          key_id: getRazorpayPublishableKey(),
          order_id: (existingIntent as any).razorpay_order_id,
          amount_paise: finalAmountPaise,
          currency: String((quote as any).currency || "INR"),
        },
        checkout_mode: checkoutMode,
      });
    }

    if (checkoutMode === "recurring_plan") {
      const recurringCapacityAddons = Array.isArray((addonsSnapshot as any)?.capacity_addons)
        ? (addonsSnapshot as any).capacity_addons
        : [];
      const oneTimeCodeAddons = Array.isArray((addonsSnapshot as any)?.code_addons)
        ? (addonsSnapshot as any).code_addons
        : [];
      if (recurringCapacityAddons.length > 0 || oneTimeCodeAddons.length > 0) {
        return apiJson(
          {
            error: "RECURRING_PLAN_ADDON_SPLIT_REQUIRED",
            message:
              "Recurring plan checkout must be completed without add-ons. Purchase the plan first, then buy add-ons separately after activation.",
            checkout_mode: checkoutMode,
          },
          { status: 409 }
        );
      }

      const planTemplateId = String((quote as any).plan_id || "").trim();
      if (!planTemplateId) {
        return apiJson({ error: "PLAN_TEMPLATE_ID_MISSING", checkout_mode: checkoutMode }, { status: 409 });
      }

      const { data: planTemplate, error: planTemplateError } = await owner.supabase
        .from("subscription_plan_templates")
        .select("id, name, billing_cycle, razorpay_plan_id")
        .eq("id", planTemplateId)
        .maybeSingle();
      if (planTemplateError) return apiJson({ error: planTemplateError.message }, { status: 500 });

      const razorpayPlanId = String((planTemplate as any)?.razorpay_plan_id || "").trim();
      if (!razorpayPlanId || razorpayPlanId.startsWith("legacy:")) {
        return apiJson({ error: "PLAN_PROVIDER_MAPPING_MISSING", checkout_mode: checkoutMode }, { status: 409 });
      }

      const createdSubscription = await createRazorpaySubscription({
        planId: razorpayPlanId,
        quoteId,
        companyId: owner.companyId,
        userId: owner.userId,
        correlationId,
        expireAtIso: String((quote as any).expires_at || "").trim() || null,
        totalCount: getRazorpaySubscriptionTotalCount((planTemplate as any)?.billing_cycle),
      });

      const subscriptionId = String(createdSubscription?.id || "").trim();
      if (!subscriptionId) {
        return apiJson({ error: "RAZORPAY_SUBSCRIPTION_CREATE_FAILED" }, { status: 502 });
      }

      const payload = {
        quote_id: quoteId,
        amount_paise: finalAmountPaise,
        correlation_id: correlationId,
        provider: "razorpay",
        provider_subscription_id: subscriptionId,
        provider_customer_id: String(createdSubscription?.customer_id || "").trim() || null,
        status: "created",
        updated_at: new Date().toISOString(),
      };

      const { data: savedIntent, error: upsertError } = await owner.supabase
        .from("payment_intents")
        .upsert(payload, { onConflict: "quote_id" })
        .select("id, provider_subscription_id")
        .single();
      if (upsertError) return apiJson({ error: upsertError.message }, { status: 500 });

      await owner.supabase
        .from("quotes")
        .update({ status: "pending_payment" })
        .eq("id", quoteId)
        .eq("status", "active");

      return apiJson({
        success: true,
        quote_id: quoteId,
        payment_intent_id: (savedIntent as any).id,
        subscription_id: (savedIntent as any).provider_subscription_id,
        correlation_id: correlationId,
        checkout_mode: checkoutMode,
        razorpay: {
          key_id: getRazorpayPublishableKey(),
          subscription_id: (savedIntent as any).provider_subscription_id,
          amount_paise: finalAmountPaise,
          currency: String((quote as any).currency || "INR"),
        },
      });
    }

    const razorpay = getRazorpayClient(keyId, keySecret);
    const createdOrder = await razorpay.orders.create({
      amount: finalAmountPaise,
      currency: String((quote as any).currency || "INR"),
      receipt: `quote_${quoteId.slice(0, 8)}_${Date.now()}`,
      notes: {
        quote_id: quoteId,
        company_id: owner.companyId,
        user_id: owner.userId,
        correlation_id: correlationId,
        final_total_paise: String(finalAmountPaise),
      },
    });
    const orderId = String(createdOrder?.id || "").trim();
    if (!orderId) {
      return apiJson({ error: "RAZORPAY_ORDER_CREATE_FAILED" }, { status: 502 });
    }

    const payload = {
      quote_id: quoteId,
      razorpay_order_id: orderId,
      amount_paise: finalAmountPaise,
      correlation_id: correlationId,
      provider: "razorpay",
      status: "created",
      updated_at: new Date().toISOString(),
    };

    const { data: savedIntent, error: upsertError } = await owner.supabase
      .from("payment_intents")
      .upsert(payload, { onConflict: "quote_id" })
      .select("id, razorpay_order_id")
      .single();
    if (upsertError) return apiJson({ error: upsertError.message }, { status: 500 });

    await owner.supabase
      .from("quotes")
      .update({ status: "pending_payment" })
      .eq("id", quoteId)
      .eq("status", "active");

    return apiJson({
      success: true,
      quote_id: quoteId,
      payment_intent_id: (savedIntent as any).id,
      order_id: (savedIntent as any).razorpay_order_id,
      correlation_id: correlationId,
      checkout_mode: checkoutMode,
      razorpay: {
        key_id: getRazorpayPublishableKey(),
        order_id: (savedIntent as any).razorpay_order_id,
        amount_paise: finalAmountPaise,
        currency: String((quote as any).currency || "INR"),
      },
    });
  } catch (error: any) {
    return apiJson(
      { error: error?.message || "Failed to initiate Razorpay checkout payment" },
      { status: 500 }
    );
  }
}


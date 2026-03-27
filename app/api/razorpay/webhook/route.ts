import crypto from "crypto";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";
import { logError, logInfo, logWarn } from "@/lib/observability";
import {
  fetchRazorpaySubscription,
  mapRazorpaySubscriptionStatusToLocal,
  toIsoFromUnix,
} from "@/lib/billing/razorpaySubscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIAL_AMOUNT_PAISE = 100;
const TRIAL_DURATION_DAYS = 10;

const TRIAL_QUOTAS = {
  unit: 5000,
  box: 500,
  carton: 100,
  pallet: 25,
  seats: 5,
  plants: 2,
  handsets: 0,
} as const;

const SUPPORTED_WEBHOOK_EVENTS = new Set([
  "payment.captured",
  "order.paid",
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.paused",
  "subscription.resumed",
  "subscription.cancelled",
  "subscription.completed",
  "invoice.paid",
  "invoice.payment_failed",
]);

function extractTrialCompanyIdFromPurpose(purpose: string): string | null {
  const value = String(purpose || "").trim();
  const prefix = "trial_activation_company_";
  if (!value.startsWith(prefix)) return null;
  const companyId = value.slice(prefix.length).trim();
  return companyId || null;
}

async function activateTrialFromPaidOrder(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  orderId: string;
  paymentId: string;
  amountPaise: number;
  correlationId: string;
  paymentNotes: any;
}) {
  const { supabase, orderId, paymentId, amountPaise, correlationId, paymentNotes } = params;

  const { data: orderRow, error: orderError } = await supabase
    .from("razorpay_orders")
    .select("order_id, purpose, receipt, amount_paise, status, payment_id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError) {
    logError("WEBHOOK_TRIAL_LOOKUP_ERROR", {
      operation: "razorpay_webhook_trial",
      correlationId,
      order_id: orderId,
      error: orderError.message,
    });
    return;
  }
  if (!orderRow) return;

  const purpose = String((orderRow as any)?.purpose || "").trim();
  const receipt = String((orderRow as any)?.receipt || "").trim();
  const companyId = extractTrialCompanyIdFromPurpose(purpose);

  const notesPurpose = String(paymentNotes?.purpose || "").trim();
  const notesCompanyId = String(paymentNotes?.company_id || "").trim();
  const notesProvided = notesPurpose.length > 0 || notesCompanyId.length > 0;
  const notesMatch = !notesProvided || (notesPurpose === purpose && notesCompanyId === companyId);

  const strictTrialMatch =
    !!companyId &&
    receipt.startsWith("trial_") &&
    Number((orderRow as any)?.amount_paise || 0) === TRIAL_AMOUNT_PAISE &&
    Math.trunc(amountPaise) === TRIAL_AMOUNT_PAISE &&
    notesMatch;

  if (!strictTrialMatch) return;

  const now = new Date();
  const nowIso = now.toISOString();

  await supabase
    .from("razorpay_orders")
    .update({
      status: "paid",
      paid_at: nowIso,
      payment_id: paymentId,
    })
    .eq("order_id", orderId);

  const trialEnd = new Date(now);
  trialEnd.setUTCDate(trialEnd.getUTCDate() + TRIAL_DURATION_DAYS);
  const trialEndIso = trialEnd.toISOString();

  const { data: insertedTrialRows, error: insertTrialError } = await supabase
    .from("company_trials")
    .upsert(
      {
        company_id: companyId,
        trial_start: nowIso,
        trial_end: trialEndIso,
        status: "active",
        updated_at: nowIso,
      },
      { onConflict: "company_id", ignoreDuplicates: true }
    )
    .select("company_id");

  if (insertTrialError) {
    logError("WEBHOOK_TRIAL_ACTIVATION_ERROR", {
      operation: "razorpay_webhook_trial",
      correlationId,
      companyId,
      order_id: orderId,
      payment_id: paymentId,
      error: insertTrialError.message,
    });
    return;
  }

  if (!insertedTrialRows || insertedTrialRows.length === 0) {
    return;
  }

  const quotaRows = [
    { resource: "unit", amount: TRIAL_QUOTAS.unit, quota_type: "variable" },
    { resource: "box", amount: TRIAL_QUOTAS.box, quota_type: "variable" },
    { resource: "carton", amount: TRIAL_QUOTAS.carton, quota_type: "variable" },
    { resource: "pallet", amount: TRIAL_QUOTAS.pallet, quota_type: "variable" },
    { resource: "seats", amount: TRIAL_QUOTAS.seats, quota_type: "base" },
    { resource: "plants", amount: TRIAL_QUOTAS.plants, quota_type: "base" },
    { resource: "handsets", amount: TRIAL_QUOTAS.handsets, quota_type: "base" },
  ]
    .filter((row) => row.amount > 0)
    .map((row) => ({
      company_id: companyId,
      source: "trial",
      quota_type: row.quota_type,
      resource: row.resource,
      amount: row.amount,
      expires_at: trialEndIso,
      metadata: {
        activated_via: "razorpay_webhook",
        activated_event: "payment.captured",
        order_id: orderId,
        payment_id: paymentId,
        correlation_id: correlationId,
      },
    }));

  if (quotaRows.length === 0) return;

  const { error: quotaError } = await supabase.from("quota_allocations").insert(quotaRows as any[]);
  if (quotaError) {
    logError("WEBHOOK_TRIAL_QUOTA_ALLOCATION_ERROR", {
      operation: "razorpay_webhook_trial",
      correlationId,
      companyId,
      order_id: orderId,
      payment_id: paymentId,
      error: quotaError.message,
    });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function validateWebhookSignature(
  body: string,
  signature: string,
  webhookSecret: string | undefined
): boolean {
  if (!webhookSecret) return false;
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
  return timingSafeEqual(expectedSignature, signature);
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function extractWebhookEventId(headersList: Headers, event: any, eventType: string): string {
  const headerEventId = headersList.get("x-razorpay-event-id")?.trim();
  if (headerEventId) return headerEventId;

  const payloadEventId = String((event as any)?.id || "").trim();
  if (payloadEventId) return payloadEventId;

  const entityId =
    String(event?.payload?.payment?.entity?.id || "").trim() ||
    String(event?.payload?.invoice?.entity?.id || "").trim() ||
    String(event?.payload?.subscription?.entity?.id || "").trim() ||
    String(event?.payload?.order?.entity?.id || "").trim();
  const createdAt = String((event as any)?.created_at || Date.now()).trim();
  return `${eventType}:${entityId || "unknown"}:${createdAt}`;
}

function extractWebhookCorrelationId(event: any, eventId: string): string {
  return (
    String(event?.payload?.payment?.entity?.notes?.correlation_id || "").trim() ||
    String(event?.payload?.invoice?.entity?.notes?.correlation_id || "").trim() ||
    String(event?.payload?.subscription?.entity?.notes?.correlation_id || "").trim() ||
    `webhook_${eventId}`
  );
}

function extractSubscriptionId(event: any): string | null {
  return (
    String(event?.payload?.subscription?.entity?.id || "").trim() ||
    String(event?.payload?.invoice?.entity?.subscription_id || "").trim() ||
    String(event?.payload?.invoice?.entity?.subscription || "").trim() ||
    null
  );
}

function extractPaymentId(event: any): string | null {
  return (
    String(event?.payload?.payment?.entity?.id || "").trim() ||
    String(event?.payload?.invoice?.entity?.payment_id || "").trim() ||
    String(event?.payload?.subscription?.entity?.charge_at || "").trim() ||
    null
  );
}

function extractOrderId(event: any): string | null {
  return (
    String(event?.payload?.payment?.entity?.order_id || "").trim() ||
    String(event?.payload?.order?.entity?.id || "").trim() ||
    null
  );
}

function extractAmountPaise(event: any): number | null {
  const amount = Number(
    event?.payload?.payment?.entity?.amount ??
      event?.payload?.invoice?.entity?.amount ??
      0
  );
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.trunc(amount);
}

function extractPeriodWindow(eventType: string, event: any) {
  const invoiceEntity = event?.payload?.invoice?.entity;
  const subscriptionEntity = event?.payload?.subscription?.entity;

  let currentPeriodStart =
    toIsoFromUnix(subscriptionEntity?.current_start) ??
    toIsoFromUnix(subscriptionEntity?.current_period_start) ??
    null;
  let currentPeriodEnd =
    toIsoFromUnix(subscriptionEntity?.current_end) ??
    toIsoFromUnix(subscriptionEntity?.current_period_end) ??
    null;
  let nextBillingAt = toIsoFromUnix(subscriptionEntity?.charge_at) ?? currentPeriodEnd;

  if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
    currentPeriodStart = toIsoFromUnix(invoiceEntity?.period_start) ?? currentPeriodStart;
    currentPeriodEnd = toIsoFromUnix(invoiceEntity?.period_end) ?? currentPeriodEnd;
    nextBillingAt = currentPeriodEnd ?? nextBillingAt;
  }

  return {
    currentPeriodStart,
    currentPeriodEnd,
    nextBillingAt,
  };
}

async function syncQuoteBackedSubscriptionFromWebhook(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  eventType: string;
  event: any;
  correlationId: string;
}) {
  const { supabase, eventType, event, correlationId } = params;
  const subscriptionId = extractSubscriptionId(event);
  if (!subscriptionId) return null;

  const { data: intent, error: intentError } = await supabase
    .from("payment_intents")
    .select("id, quote_id, provider_subscription_id, provider_customer_id, status, razorpay_payment_id")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle();
  if (intentError) throw new Error(intentError.message);
  if (!intent) return null;

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, company_id, user_id, plan_id, plan_snapshot_json, status, fulfilled_at")
    .eq("id", (intent as any).quote_id)
    .maybeSingle();
  if (quoteError) throw new Error(quoteError.message);
  if (!quote) return null;

  const providerStatus = mapRazorpaySubscriptionStatusToLocal(
    event?.payload?.subscription?.entity?.status || eventType.split(".")[1]
  );

  let providerCustomerId = String((intent as any).provider_customer_id || "").trim() || null;
  let { currentPeriodStart, currentPeriodEnd, nextBillingAt } = extractPeriodWindow(eventType, event);

  if (!currentPeriodStart || !currentPeriodEnd || !providerCustomerId) {
    try {
      const providerSubscription = await fetchRazorpaySubscription(subscriptionId);
      providerCustomerId =
        providerCustomerId || String(providerSubscription?.customer_id || "").trim() || null;
      currentPeriodStart =
        currentPeriodStart || toIsoFromUnix(providerSubscription?.current_start) || null;
      currentPeriodEnd =
        currentPeriodEnd || toIsoFromUnix(providerSubscription?.current_end) || null;
      nextBillingAt =
        nextBillingAt || toIsoFromUnix(providerSubscription?.charge_at) || currentPeriodEnd || null;
    } catch (providerFetchError) {
      console.error("Webhook provider fetch fallback failed", {
        subscription_id: subscriptionId,
        event_type: eventType,
        error: String((providerFetchError as any)?.message || "UNKNOWN"),
      });
    }
  }

  const nowIso = new Date().toISOString();
  const billingCycle =
    String(((quote as any).plan_snapshot_json || {})?.billing_cycle || "").trim().toLowerCase() === "yearly"
      ? "yearly"
      : "monthly";

  const { data: existingSubscription, error: existingSubscriptionError } = await supabase
    .from("company_subscriptions")
    .select("id, metadata")
    .eq("company_id", (quote as any).company_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingSubscriptionError) throw new Error(existingSubscriptionError.message);

  const subscriptionPayload = {
    company_id: (quote as any).company_id,
    status: providerStatus,
    plan_template_id: (quote as any).plan_id || null,
    billing_cycle: billingCycle,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    next_billing_at: nextBillingAt,
    renewal_date: currentPeriodEnd,
    start_date: currentPeriodStart,
    provider: "razorpay",
    provider_subscription_id: subscriptionId,
    razorpay_subscription_id: subscriptionId,
    provider_customer_id: providerCustomerId,
    metadata: {
      ...(((existingSubscription as any)?.metadata || {}) as Record<string, unknown>),
      last_webhook_event_type: eventType,
      last_webhook_correlation_id: correlationId,
      quote_id: (quote as any).id,
    },
    updated_at: nowIso,
  };

  if ((existingSubscription as any)?.id) {
    const { error: subscriptionUpdateError } = await supabase
      .from("company_subscriptions")
      .update(subscriptionPayload)
      .eq("id", (existingSubscription as any).id);
    if (subscriptionUpdateError) throw new Error(subscriptionUpdateError.message);
  } else {
    const { error: subscriptionInsertError } = await supabase
      .from("company_subscriptions")
      .insert({
        ...subscriptionPayload,
        activated_at: providerStatus === "active" ? nowIso : null,
      });
    if (subscriptionInsertError) throw new Error(subscriptionInsertError.message);
  }

  const providerPaymentId = extractPaymentId(event);
  const shouldFinalize = ["subscription.authenticated", "subscription.activated", "subscription.charged", "invoice.paid"].includes(eventType);

  if (eventType === "invoice.payment_failed") {
    const { error: intentFailureError } = await supabase
      .from("payment_intents")
      .update({
        status: "payment_failed",
        provider: "razorpay",
        provider_subscription_id: subscriptionId,
        provider_customer_id: providerCustomerId,
        updated_at: nowIso,
      })
      .eq("id", (intent as any).id);
    if (intentFailureError) throw new Error(intentFailureError.message);
  }

  if (shouldFinalize) {
    const { error: intentPaidError } = await supabase
      .from("payment_intents")
      .update({
        status: "paid",
        provider: "razorpay",
        provider_subscription_id: subscriptionId,
        provider_customer_id: providerCustomerId,
        razorpay_payment_id: providerPaymentId || (intent as any).razorpay_payment_id || null,
        processed_at: nowIso,
        processed_correlation_id: correlationId,
        updated_at: nowIso,
      })
      .eq("id", (intent as any).id);
    if (intentPaidError) throw new Error(intentPaidError.message);

    await finalizeQuoteInternal({
      supabase: supabase as any,
      quoteId: String((quote as any).id),
      correlationId,
    });
  }

  return {
    quote_id: (quote as any).id,
    subscription_id: subscriptionId,
    status: providerStatus,
    finalized: shouldFinalize,
  };
}

export async function POST(req: Request) {
  const headersList = await headers();
  const signature = headersList.get("x-razorpay-signature")?.trim() ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: "Webhook secret is not configured" }), { status: 503 });
  }

  if (!signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return new Response(JSON.stringify({ error: "Empty payload" }), { status: 400 });
  }

  if (!validateWebhookSignature(rawBody, signature, webhookSecret)) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const limit = await consumeRateLimit({
    key: "razorpay-webhook-global",
    refillPerMinute: 300,
    burst: 300,
  });
  if (!limit.allowed) {
    const response = new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  try {
    const eventType = String(event?.event || "").trim().toLowerCase();
    if (!SUPPORTED_WEBHOOK_EVENTS.has(eventType)) {
      return jsonResponse({ ok: true, ignored: true, event_type: eventType }, 200);
    }

    const eventId = extractWebhookEventId(headersList, event, eventType);
    const correlationId = extractWebhookCorrelationId(event, eventId);
    const supabase = getSupabaseAdmin();

    if (eventType === "payment.captured" || eventType === "order.paid") {
      const payment = event?.payload?.payment?.entity;
      const orderId = extractOrderId(event);
      const paymentId = extractPaymentId(event);
      const amountPaise = extractAmountPaise(event);

      if (eventType === "payment.captured" && orderId && paymentId && amountPaise) {
        try {
          await activateTrialFromPaidOrder({
            supabase,
            orderId,
            paymentId,
            amountPaise,
            correlationId,
            paymentNotes: payment?.notes || {},
          });
        } catch (trialActivationError) {
          console.error("Webhook paid-trial activation error:", trialActivationError);
          return jsonResponse({ ok: false, error: "TRIAL_ACTIVATION_FAILED", event_id: eventId }, 500);
        }
      }

      if (orderId && paymentId && amountPaise) {
        let quoteId: string | null = null;

        const { data: captureResult, error: captureError } = await supabase.rpc("process_payment_intent_capture", {
          p_razorpay_order_id: orderId,
          p_razorpay_payment_id: paymentId,
          p_amount_paise: amountPaise,
          p_correlation_id: correlationId,
        });

        if (captureError) {
          const message = String(captureError.message || "");
          if (message.includes("PAYMENT_INTENT_ALREADY_CAPTURED")) {
            const { data: intentRow } = await supabase
              .from("payment_intents")
              .select("quote_id")
              .eq("razorpay_order_id", orderId)
              .maybeSingle();
            quoteId = String((intentRow as any)?.quote_id || "").trim() || null;
          } else if (!message.includes("PAYMENT_INTENT_NOT_FOUND")) {
            console.error("Webhook capture error:", captureError);
            return jsonResponse({ ok: false, error: "PAYMENT_CAPTURE_PROCESSING_FAILED", event_id: eventId }, 500);
          }
        } else {
          quoteId = String((captureResult as any)?.quote_id || "").trim() || null;
        }

        if (quoteId) {
          try {
            await finalizeQuoteInternal({
              supabase: supabase as any,
              quoteId,
              correlationId,
            });
          } catch (finalizeError: any) {
            const message = String(finalizeError?.message || "");
            if (!message.includes("already_fulfilled")) {
              console.error("Webhook finalize error:", finalizeError);
              return jsonResponse({ ok: false, error: "QUOTE_FINALIZATION_FAILED", event_id: eventId }, 500);
            }
          }
        }
      }
    }

    if (eventType.startsWith("subscription.") || eventType.startsWith("invoice.")) {
      try {
        await syncQuoteBackedSubscriptionFromWebhook({
          supabase,
          eventType,
          event,
          correlationId,
        });
      } catch (subscriptionSyncError) {
        console.error("Webhook subscription sync error:", subscriptionSyncError);
        return jsonResponse({ ok: false, error: "SUBSCRIPTION_SYNC_FAILED", event_id: eventId }, 500);
      }
    }

    const { data: webhookResult, error: webhookEventError } = await supabase.rpc("process_razorpay_webhook_event", {
      p_event_id: eventId,
      p_event_type: event.event,
      p_payload: event,
      p_correlation_id: correlationId,
    });
    if (webhookEventError) {
      console.error("Webhook event RPC error:", webhookEventError);
      return jsonResponse({ ok: false, error: "WEBHOOK_EVENT_RPC_FAILED", event_id: eventId }, 500);
    }

    return jsonResponse({
      ok: true,
      event_id: eventId,
      duplicate: Boolean((webhookResult as any)?.duplicate),
      event_type: eventType,
    });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return jsonResponse({ ok: false, error: String(err?.message || "UNKNOWN_WEBHOOK_ERROR") }, 500);
  }
}


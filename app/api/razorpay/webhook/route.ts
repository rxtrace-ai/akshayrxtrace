import crypto from "crypto";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";
import { deliverNotification, getCompanyOwnerEmail } from "@/lib/notifications/delivery";
import { getAppUrl } from "@/lib/config";
import { createInvoicePdfAttachment } from "@/lib/billing/invoiceLifecycle";
import { logError, logInfo, logWarn } from "@/lib/observability";
import {
  fetchRazorpaySubscription,
  mapRazorpaySubscriptionStatusToLocal,
  toIsoFromUnix,
} from "@/lib/billing/razorpaySubscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    .select("id, metadata, start_date, current_period_start, plan_template_id, billing_cycle")
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
    start_date: (existingSubscription as any)?.start_date || currentPeriodStart,
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
  const shouldFinalize = eventType === "invoice.paid";

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

  // The first paid period is allocated by quote finalization. This RPC is
  // idempotent for that same period and allocates subsequent paid cycles from
  // the original immutable plan snapshot. The scheduler never grants paid quota.
  if ((eventType === "invoice.paid" || eventType === "subscription.charged") && currentPeriodStart && currentPeriodEnd) {
    const { data: currentSubscription, error: currentSubscriptionError } = await supabase
      .from("company_subscriptions")
      .select("id")
      .eq("company_id", (quote as any).company_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentSubscriptionError) throw new Error(currentSubscriptionError.message);
    if (currentSubscription?.id) {
      const { error: allocationError } = await supabase.rpc("allocate_paid_subscription_period", {
        p_subscription_id: currentSubscription.id,
        p_period_start: currentPeriodStart,
        p_period_end: currentPeriodEnd,
      });
      if (allocationError) throw new Error(allocationError.message);
    }
  }

  if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
    try {
    const owner = await getCompanyOwnerEmail(String((quote as any).company_id));
    const invoiceId = String(event?.payload?.invoice?.entity?.id || "").trim();
    const invoiceRowResult = invoiceId
      ? await supabase.from("billing_invoices").select("id,invoice_pdf_url,reference").eq("provider_invoice_id", invoiceId).maybeSingle()
      : { data: null, error: null };
    if (invoiceRowResult.error) throw new Error(invoiceRowResult.error.message);
    const invoiceRow = invoiceRowResult.data as any;
    const planResult = (quote as any).plan_id
      ? await supabase.from("subscription_plan_templates").select("name").eq("id", (quote as any).plan_id).maybeSingle()
      : { data: null, error: null };
    if (planResult.error) throw new Error(planResult.error.message);
    const planName = String(planResult.data?.name || (quote as any).plan_snapshot_json?.name || "Paid").toUpperCase();

    if (owner && eventType === "invoice.payment_failed") {
      await deliverNotification({
        eventType: "SUBSCRIPTION_PAYMENT_FAILED", event: "SUBSCRIPTION_PAYMENT_FAILED",
        companyId: String((quote as any).company_id), recipientEmail: owner.email,
        idempotencyKey: `subscription-payment-failed:${invoiceId || subscriptionId}`,
        metadata: { invoice_id: invoiceId, subscription_id: subscriptionId },
        payload: {
          user_name: owner.name, plan: planName,
          retry_link: `${getAppUrl()}/dashboard/subscription`,
          grace_period: currentPeriodEnd ? `Please retry before ${new Date(currentPeriodEnd).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" })}.` : "No grace period is configured; please retry promptly.",
          support_email: "support@rxtrace.in",
        },
      });
    }

    if (owner && eventType === "invoice.paid" && currentPeriodStart && currentPeriodEnd) {
      const previousTemplateId = String((existingSubscription as any)?.plan_template_id || "");
      const previousPlanResult = previousTemplateId
        ? await supabase.from("subscription_plan_templates").select("name").eq("id", previousTemplateId).maybeSingle()
        : { data: null, error: null };
      if (previousPlanResult.error) throw new Error(previousPlanResult.error.message);
      const previousPlan = String(previousPlanResult.data?.name || "").toUpperCase();
      const rank = (value: string) => ({ FREE: 0, STARTER: 1, GROWTH: 2, ENTERPRISE: 3 } as Record<string, number>)[value] ?? 0;
      const billingCycleText = billingCycle === "yearly" ? "Yearly" : "Monthly";
      const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" });
      if (previousPlan && rank(planName) > rank(previousPlan)) {
        await deliverNotification({
          eventType: "SUBSCRIPTION_UPGRADED", event: "SUBSCRIPTION_UPGRADED",
          companyId: String((quote as any).company_id), recipientEmail: owner.email,
          idempotencyKey: `subscription-upgraded:${subscriptionId}:${currentPeriodStart}:${planName}`,
          metadata: { previous_plan: previousPlan, new_plan: planName, subscription_id: subscriptionId },
          payload: { user_name: owner.name, previous_plan: previousPlan, new_plan: planName, billing_cycle: billingCycleText, effective_date: date(currentPeriodStart) },
        });
      } else if (
        previousPlan && previousPlan === planName && invoiceId &&
        String((existingSubscription as any)?.start_date || (existingSubscription as any)?.current_period_start || "") !== currentPeriodStart
      ) {
        const entitlement = await supabase.rpc("get_company_entitlement_snapshot", { p_company_id: String((quote as any).company_id), p_at: new Date().toISOString() });
        if (entitlement.error) throw new Error(entitlement.error.message);
        const remaining = (entitlement.data as any)?.remaining || {};
        const remainingText = [`Unit QR ${remaining.unit ?? 0}`, `Box QR ${remaining.box ?? 0}`, `Carton QR ${remaining.carton ?? 0}`, `Pallet SSCC ${remaining.pallet ?? 0}`].join(" • ");
        let attachments: Array<{ filename: string; contentBase64: string; contentType: string }> = [];
        if (invoiceRow?.id) {
          const attachment = await createInvoicePdfAttachment({ supabase: supabase as any, invoiceId: String(invoiceRow.id) }).catch((error) => {
            logWarn("RENEWAL_INVOICE_ATTACHMENT_FAILED", { invoice_id: invoiceId, error: String((error as any)?.message || "UNKNOWN") });
            return null;
          });
          if (attachment) attachments = [attachment];
        }
        await deliverNotification({
          eventType: "SUBSCRIPTION_RENEWED", event: "SUBSCRIPTION_RENEWED",
          companyId: String((quote as any).company_id), recipientEmail: owner.email,
          idempotencyKey: `subscription-renewed:${invoiceId}`,
          metadata: { invoice_id: invoiceId, subscription_id: subscriptionId },
          payload: { user_name: owner.name, plan: planName, start_date: date(currentPeriodStart), end_date: date(currentPeriodEnd), billing_cycle: billingCycleText, remaining_quota: remainingText, invoice_link: invoiceRow?.id ? `${getAppUrl()}/api/billing/invoice/${invoiceRow.id}/pdf` : `${getAppUrl()}/dashboard/invoices` },
          attachments,
        });
      }
    }
    } catch (notificationError) {
      logWarn("SUBSCRIPTION_NOTIFICATION_DELIVERY_FAILED", {
        companyId: String((quote as any).company_id), event_type: eventType,
        error: String((notificationError as any)?.message || "UNKNOWN"),
      });
    }
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

    if (Boolean((webhookResult as any)?.duplicate) && !eventType.startsWith("invoice.")) {
      return jsonResponse({
        ok: true,
        event_id: eventId,
        duplicate: true,
        event_type: eventType,
      });
    }

    if (eventType === "payment.captured" || eventType === "order.paid") {
      const payment = event?.payload?.payment?.entity;
      const orderId = extractOrderId(event);
      const paymentId = extractPaymentId(event);
      const amountPaise = extractAmountPaise(event);



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


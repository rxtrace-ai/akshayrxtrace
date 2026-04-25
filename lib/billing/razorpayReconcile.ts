import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";
import {
  fetchRazorpayInvoicesForSubscription,
  fetchRazorpayOrder,
  fetchRazorpayPaymentsForOrder,
  fetchRazorpaySubscription,
  mapRazorpaySubscriptionStatusToLocal,
  toIsoFromUnix,
  type RazorpayInvoiceEntity,
  type RazorpayPaymentEntity,
} from "@/lib/billing/razorpaySubscriptions";

type SupabaseLike = SupabaseClient<any>;

export type ReconcileSummary = {
  checked: number;
  repaired: Array<Record<string, unknown>>;
  unchanged: Array<Record<string, unknown>>;
  missingProvider: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
};

function normalizeProviderStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function pickCapturedOrderPayment(payments: RazorpayPaymentEntity[]): RazorpayPaymentEntity | null {
  return (
    payments.find((payment) => ["captured", "paid"].includes(normalizeProviderStatus(payment.status))) ??
    null
  );
}

function pickPaidSubscriptionInvoice(invoices: RazorpayInvoiceEntity[]): RazorpayInvoiceEntity | null {
  const paidInvoices = invoices.filter((invoice) => normalizeProviderStatus(invoice.status) === "paid");
  paidInvoices.sort((a, b) => Number(b.paid_at || 0) - Number(a.paid_at || 0));
  return paidInvoices[0] ?? null;
}

async function markIntentFailed(params: {
  supabase: SupabaseLike;
  intentId: string;
  status: "payment_failed" | "cancelled" | "expired";
  correlationId: string;
  providerSubscriptionId?: string | null;
  providerCustomerId?: string | null;
}) {
  const { supabase, intentId, status, correlationId, providerSubscriptionId, providerCustomerId } = params;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("payment_intents")
    .update({
      status,
      provider: "razorpay",
      provider_subscription_id: providerSubscriptionId || null,
      provider_customer_id: providerCustomerId || null,
      processed_correlation_id: correlationId,
      updated_at: nowIso,
    })
    .eq("id", intentId);

  if (error) {
    throw new Error(error.message);
  }
}

async function markIntentPaidAndFinalize(params: {
  supabase: SupabaseLike;
  intentId: string;
  quoteId: string;
  correlationId: string;
  providerSubscriptionId?: string | null;
  providerCustomerId?: string | null;
  providerPaymentId?: string | null;
}) {
  const {
    supabase,
    intentId,
    quoteId,
    correlationId,
    providerSubscriptionId,
    providerCustomerId,
    providerPaymentId,
  } = params;
  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("payment_intents")
    .update({
      status: "paid",
      provider: "razorpay",
      provider_subscription_id: providerSubscriptionId || null,
      provider_customer_id: providerCustomerId || null,
      razorpay_payment_id: providerPaymentId || null,
      processed_at: nowIso,
      processed_correlation_id: correlationId,
      updated_at: nowIso,
    })
    .eq("id", intentId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await finalizeQuoteInternal({
    supabase,
    quoteId,
    correlationId,
  });
}

async function reconcilePendingPaymentIntent(params: {
  supabase: SupabaseLike;
  intent: Record<string, any>;
  quote: Record<string, any> | null;
  correlationId: string;
}) {
  const { supabase, intent, quote, correlationId } = params;
  const quoteId = String(intent.quote_id || "").trim();
  const orderId = String(intent.razorpay_order_id || "").trim();
  const subscriptionId = String(intent.provider_subscription_id || "").trim();

  if (!quote || !quoteId) {
    return {
      bucket: "failures" as const,
      row: {
        payment_intent_id: intent.id,
        quote_id: quoteId || null,
        error: "QUOTE_NOT_FOUND",
      },
    };
  }

  if (quote.fulfilled_at) {
    return {
      bucket: "unchanged" as const,
      row: {
        payment_intent_id: intent.id,
        quote_id: quoteId,
        reason: "already_fulfilled",
      },
    };
  }

  if (subscriptionId) {
    const providerSubscription = await fetchRazorpaySubscription(subscriptionId);
    const providerStatus = mapRazorpaySubscriptionStatusToLocal(providerSubscription?.status);
    const providerCustomerId = String(providerSubscription?.customer_id || "").trim() || null;
    const invoices = await fetchRazorpayInvoicesForSubscription(subscriptionId);
    const paidInvoice = pickPaidSubscriptionInvoice(invoices);

    if (paidInvoice?.payment_id) {
      await markIntentPaidAndFinalize({
        supabase,
        intentId: String(intent.id),
        quoteId,
        correlationId,
        providerSubscriptionId: subscriptionId,
        providerCustomerId,
        providerPaymentId: String(paidInvoice.payment_id),
      });

      return {
        bucket: "repaired" as const,
        row: {
          payment_intent_id: intent.id,
          quote_id: quoteId,
          provider_subscription_id: subscriptionId,
          recovered_via: "invoice.paid",
        },
      };
    }

    if (["cancelled", "expired"].includes(providerStatus)) {
      await markIntentFailed({
        supabase,
        intentId: String(intent.id),
        status: providerStatus as "cancelled" | "expired",
        correlationId,
        providerSubscriptionId: subscriptionId,
        providerCustomerId,
      });

      return {
        bucket: "repaired" as const,
        row: {
          payment_intent_id: intent.id,
          quote_id: quoteId,
          provider_subscription_id: subscriptionId,
          recovered_via: providerStatus,
        },
      };
    }

    return {
      bucket: "unchanged" as const,
      row: {
        payment_intent_id: intent.id,
        quote_id: quoteId,
        provider_subscription_id: subscriptionId,
        status: providerStatus,
      },
    };
  }

  if (orderId) {
    const payments = await fetchRazorpayPaymentsForOrder(orderId);
    const capturedPayment = pickCapturedOrderPayment(payments);

    if (capturedPayment?.id && Number(capturedPayment.amount || 0) > 0) {
      const amountPaise = Math.trunc(Number(capturedPayment.amount || 0));
      const { data: captureResult, error: captureError } = await supabase.rpc("process_payment_intent_capture", {
        p_razorpay_order_id: orderId,
        p_razorpay_payment_id: String(capturedPayment.id),
        p_amount_paise: amountPaise,
        p_correlation_id: correlationId,
      });

      if (captureError) {
        throw new Error(captureError.message);
      }

      await finalizeQuoteInternal({
        supabase,
        quoteId: String((captureResult as any)?.quote_id || quoteId),
        correlationId,
      });

      return {
        bucket: "repaired" as const,
        row: {
          payment_intent_id: intent.id,
          quote_id: quoteId,
          razorpay_order_id: orderId,
          recovered_via: "payment.captured",
        },
      };
    }

    const providerOrder = await fetchRazorpayOrder(orderId);
    const providerOrderStatus = normalizeProviderStatus(providerOrder?.status);

    return {
      bucket: "unchanged" as const,
      row: {
        payment_intent_id: intent.id,
        quote_id: quoteId,
        razorpay_order_id: orderId,
        status: providerOrderStatus || "created",
      },
    };
  }

  return {
    bucket: "missingProvider" as const,
    row: {
      payment_intent_id: intent.id,
      quote_id: quoteId,
      status: intent.status,
    },
  };
}

async function syncExistingSubscriptionRows(params: {
  supabase: SupabaseLike;
  correlationId: string;
  repaired: Array<Record<string, unknown>>;
  unchanged: Array<Record<string, unknown>>;
  missingProvider: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
}) {
  const { supabase, repaired, unchanged, missingProvider, failures } = params;
  const { data: subscriptions, error } = await supabase
    .from("company_subscriptions")
    .select(
      "id, company_id, status, provider_subscription_id, razorpay_subscription_id, provider_customer_id, current_period_start, current_period_end, next_billing_at, cancel_at_period_end, updated_at"
    )
    .in("status", ["active", "pending", "pending_payment"])
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of (subscriptions || []) as any[]) {
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
        recovered_via: "subscription.sync",
      });
    } catch (providerError: any) {
      failures.push({
        company_id: row.company_id,
        provider_subscription_id: providerSubscriptionId,
        error: String(providerError?.message || "UNKNOWN_PROVIDER_FETCH_ERROR"),
      });
    }
  }
}

export async function reconcileRazorpayPayments(params: {
  supabase: SupabaseLike;
  correlationId: string;
}): Promise<ReconcileSummary> {
  const { supabase, correlationId } = params;
  const repaired: Array<Record<string, unknown>> = [];
  const unchanged: Array<Record<string, unknown>> = [];
  const missingProvider: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];

  const { data: intents, error: intentError } = await supabase
    .from("payment_intents")
    .select(
      "id, quote_id, status, amount_paise, razorpay_order_id, razorpay_payment_id, provider, provider_subscription_id, provider_customer_id, created_at, processed_at"
    )
    .in("status", ["created", "pending", "pending_payment"])
    .order("created_at", { ascending: true })
    .limit(200);

  if (intentError) {
    throw new Error(intentError.message);
  }

  const quoteIds = Array.from(
    new Set(((intents || []) as any[]).map((intent) => String(intent.quote_id || "").trim()).filter(Boolean))
  );

  const quoteById = new Map<string, Record<string, any>>();
  if (quoteIds.length > 0) {
    const { data: quotes, error: quoteError } = await supabase
      .from("quotes")
      .select("id, company_id, user_id, status, fulfilled_at, expires_at")
      .in("id", quoteIds);

    if (quoteError) {
      throw new Error(quoteError.message);
    }

    for (const quote of (quotes || []) as any[]) {
      quoteById.set(String(quote.id), quote);
    }
  }

  for (const intent of (intents || []) as any[]) {
    try {
      const result = await reconcilePendingPaymentIntent({
        supabase,
        intent,
        quote: quoteById.get(String(intent.quote_id || "").trim()) || null,
        correlationId,
      });

      if (result.bucket === "repaired") repaired.push(result.row);
      if (result.bucket === "unchanged") unchanged.push(result.row);
      if (result.bucket === "missingProvider") missingProvider.push(result.row);
      if (result.bucket === "failures") failures.push(result.row);
    } catch (error: any) {
      failures.push({
        payment_intent_id: intent.id,
        quote_id: intent.quote_id,
        error: String(error?.message || "UNKNOWN_RECONCILE_ERROR"),
      });
    }
  }

  await syncExistingSubscriptionRows({
    supabase,
    correlationId,
    repaired,
    unchanged,
    missingProvider,
    failures,
  });

  return {
    checked: (intents || []).length,
    repaired,
    unchanged,
    missingProvider,
    failures,
  };
}

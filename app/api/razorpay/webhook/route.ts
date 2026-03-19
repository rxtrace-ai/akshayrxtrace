import crypto from "crypto";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";

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
    console.error("Webhook trial lookup error:", orderError);
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
    console.error("Webhook trial activation error:", insertTrialError);
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
    console.error("Webhook trial quota allocation error:", quotaError);
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

  const limit = consumeRateLimit({
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
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), { status: 400 });
  }

  try {
    const eventType = String(event?.event || "").trim().toLowerCase();
    if (eventType !== "payment.captured") {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
    }

    const payment = event?.payload?.payment?.entity;
    const orderId = String(payment?.order_id || event?.payload?.order?.entity?.id || "").trim();
    const paymentId = String(payment?.id || "").trim();
    const amountPaise = Number(payment?.amount);
    const correlationId =
      String(payment?.notes?.correlation_id || "").trim() || `webhook_${paymentId || Date.now()}`;

    if (!orderId || !paymentId || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      console.error("Missing required payment capture data", {
        order_id: orderId,
        payment_id: paymentId,
        amount: payment?.amount,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const supabase = getSupabaseAdmin();

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
    }

    let quoteId: string | null = null;

    const { data: captureResult, error: captureError } = await supabase.rpc("process_payment_intent_capture", {
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_amount_paise: Math.trunc(amountPaise),
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
      } else {
        console.error("Webhook capture error:", captureError);
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
      } catch (finalizeError) {
        console.error("Webhook finalize error:", finalizeError);
      }
    } else {
      console.error("Webhook capture completed without quote_id", {
        order_id: orderId,
        payment_id: paymentId,
      });
    }

    const { error: webhookEventError } = await supabase.rpc("process_razorpay_webhook_event", {
      p_event_id: paymentId,
      p_event_type: event.event,
      p_payload: event,
      p_correlation_id: correlationId,
    });
    if (webhookEventError) {
      console.error("Webhook event RPC error:", webhookEventError);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200
    });
  }
}

import crypto from "crypto";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

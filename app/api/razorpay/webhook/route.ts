import crypto from "crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability";
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

function withCorrelation(
  payload: Record<string, unknown>,
  status: number,
  correlationId: string
) {
  const response = NextResponse.json(
    {
      ...payload,
      correlation_id: correlationId,
    },
    { status }
  );
  response.headers.set("X-Correlation-Id", correlationId);
  return response;
}

function extractOrderId(parsedBody: any): string | null {
  const orderId =
    parsedBody?.payload?.order?.entity?.id ??
    parsedBody?.payload?.payment?.entity?.order_id ??
    null;
  const out = typeof orderId === "string" ? orderId.trim() : "";
  return out ? out : null;
}

function extractPayment(parsedBody: any): { id: string | null; status: string | null; amount: number | null } {
  const entity = parsedBody?.payload?.payment?.entity ?? null;
  const id = typeof entity?.id === "string" ? entity.id.trim() : null;
  const status = typeof entity?.status === "string" ? entity.status.trim().toLowerCase() : null;
  const amountRaw = entity?.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  return { id, status, amount: Number.isFinite(amount) ? amount : null };
}

export async function POST(req: Request) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "webhook");
  const signature = headersList.get("x-razorpay-signature")?.trim() ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";

  if (!secret) {
    return withCorrelation({ error: "Webhook secret is not configured" }, 503, correlationId);
  }

  if (!signature) {
    return withCorrelation({ error: "Invalid signature" }, 401, correlationId);
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return withCorrelation({ error: "Empty payload" }, 400, correlationId);
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!timingSafeEqual(expectedSignature, signature)) {
    return withCorrelation({ error: "Invalid signature" }, 401, correlationId);
  }

  const limit = consumeRateLimit({
    key: "razorpay-webhook-global",
    refillPerMinute: 300,
    burst: 300,
  });
  if (!limit.allowed) {
    const response = withCorrelation({ error: "Rate limit exceeded" }, 429, correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return withCorrelation({ error: "Invalid JSON payload" }, 400, correlationId);
  }

  const eventType =
    typeof parsedBody?.event === "string" && parsedBody.event.trim()
      ? parsedBody.event.trim()
      : "unknown";

  if (eventType !== "payment.captured") {
    return withCorrelation({ success: true, ignored: true, event_type: eventType }, 200, correlationId);
  }

  const payment = extractPayment(parsedBody);
  const orderId = extractOrderId(parsedBody);
  if (!orderId || !payment.id || payment.status !== "captured" || payment.amount === null) {
    return withCorrelation({ error: "PAYMENT_CAPTURE_PAYLOAD_INVALID" }, 400, correlationId);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("process_payment_intent_capture", {
    p_razorpay_order_id: orderId,
    p_razorpay_payment_id: payment.id,
    p_amount_paise: payment.amount,
    p_correlation_id: correlationId,
  });

  if (error) {
    const message = String(error.message || "");
    if (message.includes("PAYMENT_AMOUNT_MISMATCH")) {
      return withCorrelation({ error: "PAYMENT_AMOUNT_MISMATCH" }, 409, correlationId);
    }
    if (message.includes("PAYMENT_INTENT_NOT_FOUND") || message.includes("QUOTE_NOT_FOUND")) {
      return withCorrelation({ error: "PAYMENT_INTENT_NOT_FOUND" }, 404, correlationId);
    }
    if (message.includes("PAYMENT_INTENT_ALREADY_CAPTURED")) {
      return withCorrelation(
        { success: true, duplicate: true, payment_id: payment.id, order_id: orderId, event_type: eventType },
        200,
        correlationId
      );
    }
    return withCorrelation({ error: "WEBHOOK_CAPTURE_PROCESS_FAILED" }, 500, correlationId);
  }

  const quoteId = String((data as any)?.quote_id || "").trim();
  if (!quoteId) {
    return withCorrelation({ error: "QUOTE_NOT_FOUND" }, 404, correlationId);
  }

  try {
    const finalizeResult = await finalizeQuoteInternal({
      supabase,
      quoteId,
      correlationId,
    });

    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("company_id, totals_snapshot_json, plan_snapshot_json, addons_json")
      .eq("id", quoteId)
      .maybeSingle();

    const companyId = String((quoteRow as any)?.company_id || "").trim();
    console.log("WEBHOOK HIT payment.captured", payment.id, companyId);
    if (!companyId) {
      throw new Error("Missing company_id in webhook");
    }

    const totalsSnapshot = ((quoteRow as any)?.totals_snapshot_json || {}) as Record<string, unknown>;
    const planSnapshot = ((quoteRow as any)?.plan_snapshot_json || {}) as Record<string, unknown>;
    const addonsSnapshot = ((quoteRow as any)?.addons_json || {}) as Record<string, unknown>;

    const planQuotas = (planSnapshot as any)?.quotas || {};
    const subscriptionQuantity =
      Number(planQuotas.unit || 0) +
      Number(planQuotas.box || 0) +
      Number(planQuotas.carton || 0) +
      Number(planQuotas.pallet || 0);

    const codeAddons = Array.isArray((addonsSnapshot as any)?.code_addons) ? (addonsSnapshot as any).code_addons : [];
    const capacityAddons = Array.isArray((addonsSnapshot as any)?.capacity_addons)
      ? (addonsSnapshot as any).capacity_addons
      : [];
    const addonQuantity =
      [...codeAddons, ...capacityAddons].reduce((sum: number, row: any) => {
        const allocated = Number(row?.allocated_quota ?? row?.allocated_capacity ?? row?.quantity ?? 0);
        return sum + (Number.isFinite(allocated) ? allocated : 0);
      }, 0);

    await supabase.from("quota_allocations").insert({
      company_id: companyId,
      quantity: Math.max(1, Math.trunc(subscriptionQuantity || 0)),
      source: "subscription",
      status: "active",
    } as any);

    await supabase.from("quota_allocations").insert({
      company_id: companyId,
      quantity: Math.max(1, Math.trunc(addonQuantity || 0)),
      source: "addon",
      status: "active",
    } as any);

    const amount = Math.max(0, Number(totalsSnapshot.subscription_paise || 0)) / 100;
    const gst = Math.max(0, Number(totalsSnapshot.gst_paise || 0)) / 100;
    const totalAmount = Math.max(0, Number(totalsSnapshot.final_total_paise || payment.amount || 0)) / 100;

    await supabase.from("billing_invoices").insert({
      company_id: companyId,
      amount,
      gst,
      total_amount: totalAmount,
      status: "paid",
      payment_id: payment.id,
    } as any);

    console.log("PAYMENT_CAPTURE_FINALIZED", {
      quote_id: quoteId,
      razorpay_order_id: orderId,
      razorpay_payment_id: payment.id,
      final_total_paise: (data as any)?.final_total_paise ?? payment.amount,
      processed_at: new Date().toISOString(),
      correlation_id: correlationId,
      no_op: finalizeResult.no_op,
    });

    return withCorrelation(
      {
        success: true,
        order_id: orderId,
        payment_id: payment.id,
        quote_id: quoteId,
        finalized: true,
        finalize_noop: finalizeResult.no_op,
        result: data || null,
      },
      200,
      correlationId
    );
  } catch (finalizeError: any) {
    const message = String(finalizeError?.message || "");
    if (message.includes("PAYMENT_NOT_CAPTURED_YET")) {
      return withCorrelation({ error: "PAYMENT_NOT_CAPTURED_YET" }, 409, correlationId);
    }
    return withCorrelation({ error: "WEBHOOK_FINALIZE_FAILED" }, 500, correlationId);
  }
}

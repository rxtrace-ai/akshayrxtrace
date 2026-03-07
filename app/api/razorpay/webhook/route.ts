import crypto from "crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId, logWithContext } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/security/rateLimit";

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

function deriveEventId(parsedBody: any, rawBody: string): string {
  const fromPayload = parsedBody?.event_id ?? parsedBody?.id;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  const digest = crypto.createHash("sha256").update(rawBody).digest("hex");
  return `body_sha256:${digest}`;
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

function parseTrialPurpose(purpose: string): string | null {
  const match = String(purpose || "").match(/^trial_activation_company_(.+)$/);
  if (!match) return null;
  const companyId = String(match[1] || "").trim();
  return companyId || null;
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

  const supabase = getSupabaseAdmin();
  const eventId = deriveEventId(parsedBody, rawBody);
  const eventType =
    typeof parsedBody?.event === "string" && parsedBody.event.trim()
      ? parsedBody.event.trim()
      : "unknown";
  try {
    // Trial activation side effect (₹1 order) - idempotent and webhook-driven.
    // We do it here (app layer) to avoid coupling to DB RPC versions.
    if (eventType === "payment.captured") {
      const orderId = extractOrderId(parsedBody);
      const payment = extractPayment(parsedBody);
      if (orderId) {
        const { data: orderRow } = await supabase
          .from("razorpay_orders")
          .select("order_id, purpose, payment_id, status, amount_paise")
          .eq("order_id", orderId)
          .maybeSingle();

        const companyId = orderRow?.purpose ? parseTrialPurpose(String((orderRow as any).purpose)) : null;
        if (companyId) {
          const purposeMatches = Boolean(orderRow?.purpose && parseTrialPurpose(String(orderRow.purpose)) === companyId);
          const paymentCaptured = payment.status === "captured";
          const orderAmountPaise = Number((orderRow as any)?.amount_paise ?? 0);
          const amountMatches = orderAmountPaise === 100 && payment.amount === 100;

          if (!purposeMatches || !paymentCaptured || !amountMatches) {
            logWithContext("info", "Trial activation validation failed; skipping activation", {
              correlationId,
              route: "/api/razorpay/webhook",
              eventId,
              eventType,
              orderId,
              companyId,
              purposeMatches,
              paymentCaptured,
              orderAmountPaise,
              paymentAmountPaise: payment.amount,
            });
          } else {
          // One trial per company: activate only if no legacy trial window exists and no activation marker exists.
          const { data: companyRow } = await supabase
            .from("companies")
            .select("trial_started_at, trial_expires_at, trial_activated_at")
            .eq("id", companyId)
            .maybeSingle();

          const alreadyActivated =
            Boolean((companyRow as any)?.trial_started_at) ||
            Boolean((companyRow as any)?.trial_expires_at) ||
            Boolean((companyRow as any)?.trial_activated_at);

          if (!alreadyActivated) {
            const now = new Date();
            const end = new Date(now);
            end.setUTCDate(end.getUTCDate() + 10);

            const { error: trialUpdateErr } = await supabase
              .from("companies")
              .update({
                // legacy fields used by current app logic
                trial_started_at: now.toISOString(),
                trial_expires_at: end.toISOString(),
                // new Phase 1 fields (future engine)
                trial_start_at: now.toISOString(),
                trial_end_at: end.toISOString(),
                trial_activated_at: now.toISOString(),
                trial_activated_payment_id: payment.id || null,
                updated_at: now.toISOString(),
              })
              .eq("id", companyId);

            if (!trialUpdateErr) {
              // Policy A: trial starts with a clean quota slate for this trial window.
              const periodStart = now.toISOString().slice(0, 10); // YYYY-MM-DD
              const periodEnd = end.toISOString().slice(0, 10); // YYYY-MM-DD
              const counters = ["UNIT", "BOX", "CARTON", "SSCC"].map((metricType) => ({
                company_id: companyId,
                metric_type: metricType,
                period_start: periodStart,
                period_end: periodEnd,
                used_quantity: 0,
                updated_at: now.toISOString(),
              }));

              await supabase.from("usage_counters").upsert(counters, {
                onConflict: "company_id,metric_type,period_start",
              });
            }
          }
          }
        }
      }
    }

    const { data, error } = await supabase.rpc("process_razorpay_webhook_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payload: parsedBody,
      p_correlation_id: correlationId,
    });

    if (error) {
      logWithContext("error", "Atomic webhook processing RPC failed", {
        correlationId,
        route: "/api/razorpay/webhook",
        method: "POST",
        eventId,
        eventType,
        error: error.message,
      });
      return withCorrelation({ error: "Webhook processing failed" }, 500, correlationId);
    }

    const result = (data || {}) as Record<string, unknown>;
    const duplicate = Boolean((result as any).duplicate);
    if (duplicate) {
      return withCorrelation({ success: true, duplicate: true }, 200, correlationId);
    }

    return withCorrelation(result, 200, correlationId);
  } catch (error: any) {
    logWithContext("error", "Webhook processing failed", {
      correlationId,
      route: "/api/razorpay/webhook",
      method: "POST",
      eventId,
      eventType,
      error: error?.message ?? String(error),
    });

    return withCorrelation({ error: "Webhook processing failed" }, 500, correlationId);
  }
}

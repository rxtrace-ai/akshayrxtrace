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

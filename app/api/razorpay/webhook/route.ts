import crypto from "crypto";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export async function POST(req: Request) {
  const headersList = await headers();
  const signature = headersList.get("x-razorpay-signature")?.trim() ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";

  if (!secret) {
    return new Response(JSON.stringify({ error: "Webhook secret is not configured" }), { status: 503 });
  }

  if (!signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return new Response(JSON.stringify({ error: "Empty payload" }), { status: 400 });
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!timingSafeEqual(expectedSignature, signature)) {
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
    const payment = event.payload.payment.entity;
    const companyId = payment.notes?.company_id;
    const correlationId = payment.notes?.correlation_id;

    if (!companyId || !correlationId) {
      console.error("Missing required webhook data", payment.notes);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("process_razorpay_webhook_event", {
      p_event_id: payment.id,
      p_event_type: event.event,
      p_payload: event,
      p_correlation_id: correlationId,
    });

    if (error) {
      console.error("Webhook RPC error:", error);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200
    });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRIAL_AMOUNT_PAISE = 100; // ₹1
const TRIAL_DURATION_DAYS = 10;

function normalizeIdempotencyKey(value: unknown): string {
  return String(value || "").trim();
}

function buildPurpose(companyId: string) {
  return `trial_activation_company_${companyId}`;
}

function basicAuthHeader(keyId: string, keySecret: string) {
  const token = Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const correlationId = getOrGenerateCorrelationId(await headers(), "user");
  const headerKey = req.headers.get("idempotency-key");

  const body = await req.json().catch(() => ({}));
  const idempotencyKey = normalizeIdempotencyKey((body as any)?.idempotency_key || headerKey);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
  }

  // Block if trial already activated (one trial per company)
  const { data: company, error: companyErr } = await owner.supabase
    .from("companies")
    .select("trial_activated_at, trial_started_at, trial_expires_at, trial_end_at")
    .eq("id", owner.companyId)
    .maybeSingle();
  if (companyErr) return NextResponse.json({ error: companyErr.message }, { status: 500 });

  if ((company as any)?.trial_activated_at || (company as any)?.trial_started_at) {
    return NextResponse.json({ error: "TRIAL_ALREADY_ACTIVATED" }, { status: 409 });
  }

  // Idempotency: reuse an existing created order for this company/idempotency key if present.
  const purpose = buildPurpose(owner.companyId);
  const { data: existingOrder, error: orderErr } = await owner.supabase
    .from("razorpay_orders")
    .select("order_id, amount_paise, currency, receipt, status, created_at")
    .eq("purpose", purpose)
    .eq("receipt", `trial:${idempotencyKey}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

  if (existingOrder?.order_id) {
    return NextResponse.json({
      success: true,
      replay: true,
      correlation_id: correlationId,
      trial: {
        duration_days: TRIAL_DURATION_DAYS,
        amount_paise: existingOrder.amount_paise,
        currency: existingOrder.currency || "INR",
      },
      razorpay: {
        key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
        order_id: existingOrder.order_id,
        amount_paise: existingOrder.amount_paise,
        currency: existingOrder.currency || "INR",
      },
    });
  }

  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
  }

  // Create Razorpay order (server-side)
  const receipt = `trial:${idempotencyKey}`;
  const createRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(keyId, keySecret),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: TRIAL_AMOUNT_PAISE,
      currency: "INR",
      receipt,
      notes: {
        purpose,
        company_id: owner.companyId,
        owner_user_id: owner.userId,
        correlation_id: correlationId,
      },
    }),
  });

  const createBodyText = await createRes.text();
  if (!createRes.ok) {
    return NextResponse.json(
      { error: "RAZORPAY_ORDER_CREATE_FAILED", detail: createBodyText, correlation_id: correlationId },
      { status: 502 }
    );
  }

  let created: any;
  try {
    created = JSON.parse(createBodyText);
  } catch {
    return NextResponse.json(
      { error: "RAZORPAY_ORDER_CREATE_FAILED", detail: "Invalid Razorpay response", correlation_id: correlationId },
      { status: 502 }
    );
  }

  const orderId = String(created?.id || "").trim();
  if (!orderId) {
    return NextResponse.json(
      { error: "RAZORPAY_ORDER_CREATE_FAILED", detail: "Missing order id", correlation_id: correlationId },
      { status: 502 }
    );
  }

  // Persist order for webhook-driven activation
  const { error: insertErr } = await owner.supabase.from("razorpay_orders").insert({
    order_id: orderId,
    payment_id: null,
    amount: 1,
    amount_paise: TRIAL_AMOUNT_PAISE,
    currency: "INR",
    receipt,
    status: String(created?.status || "created"),
    purpose,
  });
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    correlation_id: correlationId,
    trial: { duration_days: TRIAL_DURATION_DAYS, amount_paise: TRIAL_AMOUNT_PAISE, currency: "INR" },
    razorpay: {
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
      order_id: orderId,
      amount_paise: TRIAL_AMOUNT_PAISE,
      currency: "INR",
    },
  });
}


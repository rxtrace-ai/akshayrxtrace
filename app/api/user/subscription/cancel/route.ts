import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { checkUserIdempotency, hashRequestBody, storeUserIdempotencyResponse } from "@/lib/user/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeIdempotencyKey(req: NextRequest, body: any): string {
  return String(body?.idempotency_key || req.headers.get("idempotency-key") || "").trim();
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => ({}));
  const correlationId = getOrGenerateCorrelationId(await headers(), "user");
  const idempotencyKey = normalizeIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
  }

  const requestHash = hashRequestBody(body);
  const idem = await checkUserIdempotency({
    supabase: owner.supabase,
    userId: owner.userId,
    endpoint: "/api/user/subscription/cancel",
    idempotencyKey,
    requestHash,
  });
  if (idem.kind === "missing_key") return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
  if (idem.kind === "conflict") return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  if (idem.kind === "replay") return NextResponse.json(idem.payload, { status: idem.statusCode });

  const { data: updated, error } = await owner.supabase
    .from("company_subscriptions")
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("company_id", owner.companyId)
    .in("status", ["active", "authenticated", "pending", "paused", "past_due"])
    .select("status, cancel_at_period_end, current_period_end, next_billing_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "NO_ACTIVE_SUBSCRIPTION" }, { status: 409 });
  }

  const payload = {
    success: true,
    subscription: {
      status: (updated as any).status,
      cancel_at_period_end: (updated as any).cancel_at_period_end,
      current_period_end: (updated as any).current_period_end ?? null,
      next_billing_at: (updated as any).next_billing_at ?? null,
    },
    correlation_id: correlationId,
  };

  await storeUserIdempotencyResponse({
    supabase: owner.supabase,
    userId: owner.userId,
    endpoint: "/api/user/subscription/cancel",
    idempotencyKey: (idem as any).key ?? idempotencyKey,
    requestHash,
    statusCode: 200,
    payload,
    correlationId,
  });

  return NextResponse.json(payload, { status: 200 });
}

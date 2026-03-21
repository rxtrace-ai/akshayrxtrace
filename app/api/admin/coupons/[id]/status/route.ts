import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import {
  checkAdminIdempotency,
  idempotencyErrorResponse,
  persistAdminIdempotencyResult,
} from "@/lib/admin/idempotency";
import { appendAdminMutationAuditEvent } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const params = await ctx.params;
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const endpoint = `/api/admin/coupons/${params.id}/status`;
  const idempotencyKey = headersList.get("idempotency-key");

  const auth = await requireSuperAdmin();
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);

  const limit = await consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const couponId = normalizeText(params.id);
  if (!couponId) return errorResponse(400, "BAD_REQUEST", "id is required", correlationId);

  const body = await req.json().catch(() => ({}));
  if (typeof (body as any).active !== "boolean") {
    return errorResponse(400, "BAD_REQUEST", "active boolean is required", correlationId);
  }
  const active = Boolean((body as any).active);

  const idempotency = await checkAdminIdempotency({
    adminId: auth.userId,
    endpoint,
    method: "PATCH",
    idempotencyKey,
    body,
  });
  if (idempotency.kind === "missing_key" || idempotency.kind === "conflict") {
    return idempotencyErrorResponse(idempotency.kind, correlationId);
  }
  if (idempotency.kind === "replay") return successResponse(idempotency.statusCode, idempotency.payload, correlationId);

  const supabase = getSupabaseAdmin();
  const { data: before, error: beforeError } = await supabase
    .from("coupons")
    .select("*")
    .eq("id", couponId)
    .maybeSingle();
  if (beforeError) return errorResponse(500, "INTERNAL_ERROR", beforeError.message, correlationId);
  if (!before) return errorResponse(404, "NOT_FOUND", "Coupon not found", correlationId);

  const { data, error } = await supabase
    .from("coupons")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", couponId)
    .select("*")
    .single();
  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, coupon: data };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: active ? "ADMIN_COUPON_ACTIVATED" : "ADMIN_COUPON_DEACTIVATED",
    entityType: "coupon",
    entityId: couponId,
    beforeState: (before || {}) as Record<string, unknown>,
    afterState: (data || {}) as Record<string, unknown>,
    correlationId,
    supabase,
  });
  await persistAdminIdempotencyResult({
    adminId: auth.userId,
    endpoint,
    idempotencyKey: idempotency.key,
    requestHash: idempotency.requestHash,
    statusCode: 200,
    payload,
    correlationId,
    supabase,
  });

  return successResponse(200, payload, correlationId);
}



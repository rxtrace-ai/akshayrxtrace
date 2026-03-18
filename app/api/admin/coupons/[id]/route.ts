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

function normalizeIso(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const endpoint = `/api/admin/coupons/${params.id}`;
  const idempotencyKey = headersList.get("idempotency-key");

  const auth = await requireSuperAdmin();
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);

  const limit = consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const couponId = normalizeText(params.id);
  if (!couponId) return errorResponse(400, "BAD_REQUEST", "id is required", correlationId);

  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if ("code" in (body as any)) {
    const code = normalizeText((body as any).code).toUpperCase();
    if (!code) return errorResponse(400, "BAD_REQUEST", "code cannot be empty", correlationId);
    updates.code = code;
  }
  if ("discount_type" in (body as any)) {
    const discountType = normalizeText((body as any).discount_type).toLowerCase();
    if (!["percentage", "flat"].includes(discountType)) {
      return errorResponse(400, "BAD_REQUEST", "discount_type must be percentage or flat", correlationId);
    }
    updates.discount_type = discountType;
  }
  if ("discount_value" in (body as any)) {
    const discountValue = Number((body as any).discount_value);
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      return errorResponse(400, "BAD_REQUEST", "discount_value must be >= 0", correlationId);
    }
    updates.discount_value = Math.max(0, Math.trunc(discountValue));
  }
  if ("max_discount_paise" in (body as any)) {
    const raw = (body as any).max_discount_paise;
    updates.max_discount_paise =
      raw === null || raw === undefined || raw === "" ? null : Math.max(0, Math.trunc(Number(raw)));
  }
  if ("active" in (body as any) && typeof (body as any).active === "boolean") {
    updates.active = Boolean((body as any).active);
  }
  if ("valid_from" in (body as any)) updates.valid_from = normalizeIso((body as any).valid_from);
  if ("valid_until" in (body as any)) updates.valid_until = normalizeIso((body as any).valid_until);
  if ("usage_limit" in (body as any)) {
    const raw = (body as any).usage_limit;
    updates.usage_limit = raw === null || raw === undefined || raw === "" ? null : Math.max(0, Math.trunc(Number(raw)));
  }
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "BAD_REQUEST", "No update fields provided", correlationId);
  }
  updates.updated_at = new Date().toISOString();

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
    .update(updates)
    .eq("id", couponId)
    .select("*")
    .single();
  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, coupon: data };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_COUPON_UPDATED",
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

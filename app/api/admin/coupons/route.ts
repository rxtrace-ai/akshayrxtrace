import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminRole, requireSuperAdmin } from "@/lib/auth/admin";
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

function parseCouponPayload(body: Record<string, unknown>, isUpdate = false): { value?: Record<string, unknown>; error?: string } {
  const code = normalizeText(body.code).toUpperCase();
  const discountType = normalizeText(body.discount_type).toLowerCase();
  const discountValue = Number(body.discount_value);

  const maxDiscountRaw = body.max_discount_paise ?? body.max_discount;
  const maxDiscountPaise =
    maxDiscountRaw === null || maxDiscountRaw === undefined || maxDiscountRaw === ""
      ? null
      : Math.max(0, Math.trunc(Number(maxDiscountRaw)));

  const validFrom = normalizeIso(body.valid_from);
  const validUntil = normalizeIso(body.valid_until);
  const usageLimitRaw = body.usage_limit;
  const usageLimit =
    usageLimitRaw === null || usageLimitRaw === undefined || usageLimitRaw === ""
      ? null
      : Math.max(0, Math.trunc(Number(usageLimitRaw)));

  const active = typeof body.active === "boolean" ? body.active : undefined;

  if (!isUpdate) {
    if (!code) return { error: "code is required" };
    if (!["percentage", "flat"].includes(discountType)) return { error: "discount_type must be percentage or flat" };
    if (!Number.isFinite(discountValue) || discountValue < 0) return { error: "discount_value must be >= 0" };
  }

  if (discountType && !["percentage", "flat"].includes(discountType)) {
    return { error: "discount_type must be percentage or flat" };
  }
  if (Number.isFinite(discountValue) && discountType === "percentage" && (discountValue < 0 || discountValue > 100)) {
    return { error: "percentage coupon must be between 0 and 100" };
  }
  if (validFrom && validUntil && new Date(validUntil).getTime() < new Date(validFrom).getTime()) {
    return { error: "valid_until must be >= valid_from" };
  }

  const payload: Record<string, unknown> = {};
  if (code) payload.code = code;
  if (discountType) payload.discount_type = discountType;
  if (Number.isFinite(discountValue)) payload.discount_value = Math.max(0, Math.trunc(discountValue));
  if (maxDiscountPaise !== null || "max_discount_paise" in body || "max_discount" in body) payload.max_discount_paise = maxDiscountPaise;
  if (active !== undefined) payload.active = active;
  if ("valid_from" in body) payload.valid_from = validFrom;
  if ("valid_until" in body) payload.valid_until = validUntil;
  if ("usage_limit" in body) payload.usage_limit = usageLimit;

  return { value: payload };
}

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  return successResponse(200, { success: true, coupons: data || [] }, correlationId);
}

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const endpoint = "/api/admin/coupons";
  const idempotencyKey = headersList.get("idempotency-key");

  const auth = await requireSuperAdmin();
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);

  const limit = consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await req.json().catch(() => ({}));
  const parsed = parseCouponPayload(body as Record<string, unknown>, false);
  if (!parsed.value) return errorResponse(400, "BAD_REQUEST", parsed.error || "Invalid payload", correlationId);

  const idempotency = await checkAdminIdempotency({
    adminId: auth.userId,
    endpoint,
    method: "POST",
    idempotencyKey,
    body,
  });
  if (idempotency.kind === "missing_key" || idempotency.kind === "conflict") {
    return idempotencyErrorResponse(idempotency.kind, correlationId);
  }
  if (idempotency.kind === "replay") return successResponse(idempotency.statusCode, idempotency.payload, correlationId);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      ...parsed.value,
      active: (parsed.value.active as boolean | undefined) ?? true,
      used_count: 0,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, coupon: data };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_COUPON_CREATED",
    entityType: "coupon",
    entityId: String((data as any)?.id || ""),
    beforeState: null,
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

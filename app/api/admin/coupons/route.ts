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

const VALID_TYPES = new Set(["percentage", "flat"]);
const VALID_SCOPES = new Set(["subscription", "addons", "both"]);

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

function normalizeCouponPayload(body: Record<string, unknown>, isUpdate: boolean): { value?: Record<string, unknown>; error?: string } {
  const code = normalizeText(body.code).toUpperCase();
  const type = normalizeText(body.type).toLowerCase();
  const scope = normalizeText(body.scope).toLowerCase() || "both";
  const value = Number(body.value);
  const validFrom = normalizeIso(body.valid_from) || new Date().toISOString();
  const validTo = normalizeIso(body.valid_to);
  const usageLimitRaw = body.usage_limit;
  const usageLimit = usageLimitRaw === null || usageLimitRaw === undefined || usageLimitRaw === ""
    ? null
    : Number(usageLimitRaw);
  const isActive = typeof body.is_active === "boolean" ? body.is_active : undefined;
  const razorpayOfferId = normalizeText(body.razorpay_offer_id) || null;

  if (!isUpdate) {
    if (!code) return { error: "code is required" };
    if (!VALID_TYPES.has(type)) return { error: "type must be percentage or flat" };
    if (!Number.isFinite(value) || value < 0) return { error: "value must be a non-negative number" };
  }

  if (type && !VALID_TYPES.has(type)) return { error: "type must be percentage or flat" };
  if (scope && !VALID_SCOPES.has(scope)) return { error: "scope must be subscription, addons, or both" };
  if (validTo && new Date(validTo).getTime() < new Date(validFrom).getTime()) {
    return { error: "valid_to must be >= valid_from" };
  }
  if (usageLimit !== null && (!Number.isFinite(usageLimit) || usageLimit < 0)) {
    return { error: "usage_limit must be null or a non-negative number" };
  }

  const payload: Record<string, unknown> = {
    code,
    type,
    value: Number.isFinite(value) ? value : 0,
    valid_from: validFrom,
    valid_to: validTo,
    usage_limit: usageLimit,
    scope,
    razorpay_offer_id: razorpayOfferId,
  };
  if (isActive !== undefined) payload.is_active = isActive;
  return { value: payload };
}

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("discounts")
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
  const normalized = normalizeCouponPayload(body as Record<string, unknown>, false);
  if (!normalized.value) return errorResponse(400, "BAD_REQUEST", normalized.error || "Invalid payload", correlationId);

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
    .from("discounts")
    .insert({
      ...normalized.value,
      is_active: true,
      usage_count: 0,
    })
    .select()
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

export async function PUT(req: NextRequest) {
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
  const id = normalizeText((body as any).id);
  if (!id) return errorResponse(400, "BAD_REQUEST", "id is required", correlationId);

  const normalized = normalizeCouponPayload(body as Record<string, unknown>, true);
  if (!normalized.value) return errorResponse(400, "BAD_REQUEST", normalized.error || "Invalid payload", correlationId);

  const idempotency = await checkAdminIdempotency({
    adminId: auth.userId,
    endpoint,
    method: "PUT",
    idempotencyKey,
    body,
  });
  if (idempotency.kind === "missing_key" || idempotency.kind === "conflict") {
    return idempotencyErrorResponse(idempotency.kind, correlationId);
  }
  if (idempotency.kind === "replay") return successResponse(idempotency.statusCode, idempotency.payload, correlationId);

  const supabase = getSupabaseAdmin();

  const { data: before, error: beforeError } = await supabase
    .from("discounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) return errorResponse(500, "INTERNAL_ERROR", beforeError.message, correlationId);
  if (!before) return errorResponse(404, "NOT_FOUND", "Coupon not found", correlationId);

  const updates: Record<string, unknown> = {};
  if ("code" in (body as any)) updates.code = normalized.value.code;
  if ("type" in (body as any)) updates.type = normalized.value.type;
  if ("value" in (body as any)) updates.value = normalized.value.value;
  if ("valid_from" in (body as any)) updates.valid_from = normalized.value.valid_from;
  if ("valid_to" in (body as any)) updates.valid_to = normalized.value.valid_to;
  if ("usage_limit" in (body as any)) updates.usage_limit = normalized.value.usage_limit;
  if ("is_active" in (body as any)) updates.is_active = normalized.value.is_active;
  if ("scope" in (body as any)) updates.scope = normalized.value.scope;
  if ("razorpay_offer_id" in (body as any)) updates.razorpay_offer_id = normalized.value.razorpay_offer_id;
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "BAD_REQUEST", "No update fields provided", correlationId);
  }

  const { data, error } = await supabase
    .from("discounts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, coupon: data };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_COUPON_UPDATED",
    entityType: "coupon",
    entityId: id,
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

export async function DELETE(req: NextRequest) {
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
  const id = normalizeText((body as any).id);
  if (!id) return errorResponse(400, "BAD_REQUEST", "id is required", correlationId);

  const idempotency = await checkAdminIdempotency({
    adminId: auth.userId,
    endpoint,
    method: "DELETE",
    idempotencyKey,
    body,
  });
  if (idempotency.kind === "missing_key" || idempotency.kind === "conflict") {
    return idempotencyErrorResponse(idempotency.kind, correlationId);
  }
  if (idempotency.kind === "replay") return successResponse(idempotency.statusCode, idempotency.payload, correlationId);

  const supabase = getSupabaseAdmin();

  const { data: before, error: beforeError } = await supabase
    .from("discounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) return errorResponse(500, "INTERNAL_ERROR", beforeError.message, correlationId);
  if (!before) return errorResponse(404, "NOT_FOUND", "Coupon not found", correlationId);

  const { data: coupon, error } = await supabase
    .from("discounts")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, coupon };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_COUPON_DEACTIVATED",
    entityType: "coupon",
    entityId: id,
    beforeState: (before || {}) as Record<string, unknown>,
    afterState: (coupon || {}) as Record<string, unknown>,
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

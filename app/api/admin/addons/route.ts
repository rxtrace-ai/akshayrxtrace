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

const STRUCTURAL_KEYS = new Set(["seat", "plant", "handset"]);
const VARIABLE_KEYS = new Set(["unit", "box", "carton", "pallet"]);
const VALID_KEYS = new Set([...STRUCTURAL_KEYS, ...VARIABLE_KEYS]);

type NormalizedAddOn = {
  name: string;
  description: string | null;
  price: number;
  unit: string;
  recurring: boolean;
  display_order: number;
  is_active?: boolean;
  addon_kind: "structural" | "variable_quota";
  entitlement_key: "seat" | "plant" | "handset" | "unit" | "box" | "carton" | "pallet";
  billing_mode: "recurring" | "one_time";
  razorpay_item_id: string | null;
};

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function inferEntitlementFromName(name: string): NormalizedAddOn["entitlement_key"] {
  const value = name.toLowerCase();
  if (value.includes("seat") || value.includes("user")) return "seat";
  if (value.includes("plant")) return "plant";
  if (value.includes("handset") || value.includes("device")) return "handset";
  if (value.includes("carton")) return "carton";
  if (value.includes("box")) return "box";
  if (value.includes("pallet") || value.includes("sscc")) return "pallet";
  return "unit";
}

function normalizeAddOnPayload(body: Record<string, unknown>, isUpdate: boolean): { value?: NormalizedAddOn; error?: string } {
  const name = normalizeText(body.name);
  const description = normalizeText(body.description);
  const unit = normalizeText(body.unit) || "unit";
  const entitlementRaw = normalizeText(body.entitlement_key).toLowerCase();
  const kindRaw = normalizeText(body.addon_kind).toLowerCase();
  const billingModeRaw = normalizeText(body.billing_mode).toLowerCase();
  const recurringRaw = body.recurring;
  const price = parseNumber(body.price, NaN);
  const displayOrder = parseNumber(body.display_order, 0);
  const isActive = typeof body.is_active === "boolean" ? body.is_active : undefined;
  const razorpayItemId = normalizeText(body.razorpay_item_id) || null;

  if (!isUpdate) {
    if (!name) return { error: "name is required" };
    if (!Number.isFinite(price) || price < 0) return { error: "price must be a non-negative number" };
  }

  const entitlement =
    (entitlementRaw && VALID_KEYS.has(entitlementRaw) ? entitlementRaw : inferEntitlementFromName(name || "unit")) as NormalizedAddOn["entitlement_key"];
  const inferredKind: NormalizedAddOn["addon_kind"] = STRUCTURAL_KEYS.has(entitlement) ? "structural" : "variable_quota";
  const addonKind = (kindRaw === "structural" || kindRaw === "variable_quota" ? kindRaw : inferredKind) as NormalizedAddOn["addon_kind"];
  const billingMode =
    (billingModeRaw === "recurring" || billingModeRaw === "one_time"
      ? billingModeRaw
      : addonKind === "structural"
      ? "recurring"
      : "one_time") as NormalizedAddOn["billing_mode"];

  if (addonKind === "structural" && !STRUCTURAL_KEYS.has(entitlement)) {
    return { error: "structural add-ons must use entitlement_key seat|plant|handset" };
  }
  if (addonKind === "variable_quota" && !VARIABLE_KEYS.has(entitlement)) {
    return { error: "variable_quota add-ons must use entitlement_key unit|box|carton|pallet" };
  }

  const recurring =
    typeof recurringRaw === "boolean"
      ? recurringRaw
      : billingMode === "recurring";

  const normalized: NormalizedAddOn = {
    name,
    description: description || null,
    price: Number.isFinite(price) ? price : 0,
    unit,
    recurring,
    display_order: Math.max(0, Math.trunc(displayOrder)),
    is_active: isActive,
    addon_kind: addonKind,
    entitlement_key: entitlement,
    billing_mode: billingMode,
    razorpay_item_id: razorpayItemId,
  };

  return { value: normalized };
}

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("add_ons")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  return successResponse(200, { success: true, add_ons: data || [] }, correlationId);
}

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const endpoint = "/api/admin/addons";
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
  const normalized = normalizeAddOnPayload(body as Record<string, unknown>, false);
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
  const { data: addOn, error } = await supabase
    .from("add_ons")
    .insert(normalized.value)
    .select()
    .single();

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, add_on: addOn };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_ADDON_CREATED",
    entityType: "add_on",
    entityId: String((addOn as any)?.id || ""),
    beforeState: null,
    afterState: (addOn || {}) as Record<string, unknown>,
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
  const endpoint = "/api/admin/addons";
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

  const normalized = normalizeAddOnPayload(body as Record<string, unknown>, true);
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
    .from("add_ons")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (beforeError) return errorResponse(500, "INTERNAL_ERROR", beforeError.message, correlationId);
  if (!before) return errorResponse(404, "NOT_FOUND", "Add-on not found", correlationId);

  const updates: Record<string, unknown> = {};
  if ("name" in (body as any)) updates.name = normalized.value.name;
  if ("description" in (body as any)) updates.description = normalized.value.description;
  if ("price" in (body as any)) updates.price = normalized.value.price;
  if ("unit" in (body as any)) updates.unit = normalized.value.unit;
  if ("recurring" in (body as any) || "billing_mode" in (body as any)) updates.recurring = normalized.value.recurring;
  if ("display_order" in (body as any)) updates.display_order = normalized.value.display_order;
  if ("is_active" in (body as any)) updates.is_active = normalized.value.is_active;
  if ("addon_kind" in (body as any) || "entitlement_key" in (body as any) || "billing_mode" in (body as any) || "name" in (body as any)) {
    updates.addon_kind = normalized.value.addon_kind;
    updates.entitlement_key = normalized.value.entitlement_key;
    updates.billing_mode = normalized.value.billing_mode;
  }
  if ("razorpay_item_id" in (body as any)) updates.razorpay_item_id = normalized.value.razorpay_item_id;
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "BAD_REQUEST", "No update fields provided", correlationId);
  }

  const { data: addOn, error } = await supabase
    .from("add_ons")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);

  const payload = { success: true, add_on: addOn };
  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_ADDON_UPDATED",
    entityType: "add_on",
    entityId: id,
    beforeState: (before || {}) as Record<string, unknown>,
    afterState: (addOn || {}) as Record<string, unknown>,
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

import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireAdminRole, requireSuperAdmin } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import {
  checkAdminIdempotency,
  idempotencyErrorResponse,
  persistAdminIdempotencyResult,
} from "@/lib/admin/idempotency";
import { appendAdminMutationAuditEvent } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanVersionInput = {
  unit_quota_units: number;
  box_quota_units: number;
  carton_quota_units: number;
  pallet_quota_units: number;
  seat_limit: number;
  plant_limit: number;
  handset_limit: number;
  is_active: boolean;
  change_note: string | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeProviderPlanId(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function toPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function computeFinalQuota(units: number, pricingUnitSize: number): number {
  return Math.max(0, units) * Math.max(1, pricingUnitSize);
}

function normalizeVersionInput(input: Record<string, unknown>): PlanVersionInput {
  return {
    unit_quota_units: nonNegativeInt(input.unit_quota_units ?? input.unit_quota),
    box_quota_units: nonNegativeInt(input.box_quota_units ?? input.box_quota),
    carton_quota_units: nonNegativeInt(input.carton_quota_units ?? input.carton_quota),
    pallet_quota_units: nonNegativeInt(input.pallet_quota_units ?? input.pallet_quota),
    seat_limit: nonNegativeInt(input.seat_limit),
    plant_limit: nonNegativeInt(input.plant_limit),
    handset_limit: nonNegativeInt(input.handset_limit),
    is_active: input.is_active === true,
    change_note: normalizeText(input.change_note) || null,
  };
}

function mapVersionForResponse(row: any, pricingUnitSize: number) {
  const unitQuotaUnits = nonNegativeInt(row.unit_quota_units);
  const boxQuotaUnits = nonNegativeInt(row.box_quota_units);
  const cartonQuotaUnits = nonNegativeInt(row.carton_quota_units);
  const palletQuotaUnits = nonNegativeInt(row.pallet_quota_units);
  const resolvedPricingUnitSize = Math.max(1, nonNegativeInt(pricingUnitSize, 1));

  return {
    id: row.id,
    template_id: row.template_id,
    version_number: nonNegativeInt(row.version_number, 1),
    unit_quota_units: unitQuotaUnits,
    box_quota_units: boxQuotaUnits,
    carton_quota_units: cartonQuotaUnits,
    pallet_quota_units: palletQuotaUnits,
    unit_limit: nonNegativeInt(row.unit_limit ?? computeFinalQuota(unitQuotaUnits, resolvedPricingUnitSize)),
    box_limit: nonNegativeInt(row.box_limit ?? computeFinalQuota(boxQuotaUnits, resolvedPricingUnitSize)),
    carton_limit: nonNegativeInt(row.carton_limit ?? computeFinalQuota(cartonQuotaUnits, resolvedPricingUnitSize)),
    pallet_limit: nonNegativeInt(row.pallet_limit ?? computeFinalQuota(palletQuotaUnits, resolvedPricingUnitSize)),
    seat_limit: nonNegativeInt(row.seat_limit),
    plant_limit: nonNegativeInt(row.plant_limit),
    handset_limit: nonNegativeInt(row.handset_limit),
    is_active: row.is_active === true,
    effective_from: row.effective_from ?? null,
    effective_to: row.effective_to ?? null,
    change_note: row.change_note ?? null,
    created_at: row.created_at ?? null,
  };
}

async function fetchTemplateWithVersions(supabase: ReturnType<typeof getSupabaseAdmin>, templateId: string) {
  const { data: template, error: templateError } = await supabase
    .from("subscription_plan_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();

  if (templateError) throw new Error(templateError.message);
  if (!template) return null;

  const { data: versions, error: versionsError } = await supabase
    .from("subscription_plan_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version_number", { ascending: false });

  if (versionsError) throw new Error(versionsError.message);
  const mappedVersions = (versions || []).map((row: any) =>
    mapVersionForResponse(row, nonNegativeInt((template as any).pricing_unit_size, 1))
  );

  return {
    template: {
      id: (template as any).id,
      name: (template as any).name,
      description: (template as any).description ?? null,
      billing_cycle: (template as any).billing_cycle === "yearly" ? "yearly" : "monthly",
      plan_price: toPaise((template as any).plan_price ?? (template as any).amount_from_razorpay),
      razorpay_plan_id: String((template as any).razorpay_plan_id || "").trim() || null,
      pricing_unit_size: Math.max(1, nonNegativeInt((template as any).pricing_unit_size, 1)),
      is_active: (template as any).is_active === true,
      updated_at: (template as any).updated_at ?? null,
    },
    versions: mappedVersions,
    active_version: mappedVersions.find((row: any) => row.is_active) || mappedVersions[0] || null,
  };
}

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();

  const { data: templates, error: templatesError } = await supabase
    .from("subscription_plan_templates")
    .select("*")
    .order("name", { ascending: true });

  if (templatesError) {
    return errorResponse(500, "INTERNAL_ERROR", templatesError.message, correlationId);
  }

  const templateIds = (templates || []).map((row: any) => row.id);
  const { data: versions, error: versionsError } = templateIds.length
    ? await supabase
        .from("subscription_plan_versions")
        .select("*")
        .in("template_id", templateIds)
        .order("version_number", { ascending: false })
    : { data: [], error: null as any };

  if (versionsError) {
    return errorResponse(500, "INTERNAL_ERROR", versionsError.message, correlationId);
  }

  const grouped = new Map<string, any[]>();
  for (const row of versions || []) {
    const templateId = (row as any).template_id;
    if (!grouped.has(templateId)) grouped.set(templateId, []);
    grouped.get(templateId)!.push(row as any);
  }

  const plans = (templates || []).map((template: any) => {
    const pricingUnitSize = Math.max(1, nonNegativeInt(template.pricing_unit_size, 1));
    const rows = (grouped.get(template.id) || []).map((row) => mapVersionForResponse(row, pricingUnitSize));
    const activeVersion = rows.find((row) => row.is_active) || rows[0] || null;

    return {
      template: {
        id: template.id,
        name: template.name,
        description: template.description ?? null,
        billing_cycle: template.billing_cycle === "yearly" ? "yearly" : "monthly",
        plan_price: toPaise(template.plan_price ?? template.amount_from_razorpay),
        razorpay_plan_id: String(template.razorpay_plan_id || "").trim() || null,
        pricing_unit_size: pricingUnitSize,
        is_active: template.is_active === true,
        updated_at: template.updated_at ?? null,
      },
      active_version: activeVersion,
      versions_count: rows.length,
      versions: rows,
    };
  });

  return successResponse(200, { success: true, plans }, correlationId);
}

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const endpoint = "/api/admin/subscription-plans";
  const idempotencyKey = headersList.get("idempotency-key");

  const auth = await requireSuperAdmin();
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);

  const limit = await consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await req.json().catch(() => ({}));
  const templateId = normalizeText((body as any).template_id);
  const name = normalizeText((body as any).name);
  const description = normalizeText((body as any).description) || null;
  const billingCycle = normalizeText((body as any).billing_cycle).toLowerCase();
  const planPrice = toPaise((body as any).plan_price);
  const razorpayPlanId = normalizeProviderPlanId((body as any).razorpay_plan_id);
  const pricingUnitSize = Math.max(1, nonNegativeInt((body as any).pricing_unit_size, 1));
  const publish = (body as any).publish !== false;
  const versionInput = normalizeVersionInput(((body as any).version || body) as Record<string, unknown>);

  if (!templateId && (!name || !["monthly", "yearly"].includes(billingCycle))) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "name and billing_cycle(monthly|yearly) are required when template_id is not provided",
      correlationId
    );
  }
  if (!templateId && !razorpayPlanId) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "razorpay_plan_id is required when creating a template",
      correlationId
    );
  }

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
  let resolvedTemplateId = templateId;
  let beforeState: Record<string, unknown> | null = null;

  if (!resolvedTemplateId) {
    const { data: createdTemplate, error: createTemplateError } = await supabase
      .from("subscription_plan_templates")
      .insert({
        name,
        description,
        billing_cycle: billingCycle,
        plan_price: planPrice,
        razorpay_plan_id: razorpayPlanId,
        pricing_unit_size: pricingUnitSize,
        is_active: true,
      })
      .select("*")
      .single();
    if (createTemplateError) return errorResponse(500, "INTERNAL_ERROR", createTemplateError.message, correlationId);
    resolvedTemplateId = String((createdTemplate as any).id);
  } else {
    const current = await fetchTemplateWithVersions(supabase, resolvedTemplateId);
    if (!current) return errorResponse(404, "NOT_FOUND", "Template not found", correlationId);
    beforeState = current as unknown as Record<string, unknown>;
  }

  const { data: templateRow, error: templateError } = await supabase
    .from("subscription_plan_templates")
    .select("*")
    .eq("id", resolvedTemplateId)
    .single();
  if (templateError) return errorResponse(500, "INTERNAL_ERROR", templateError.message, correlationId);

  const { data: latestVersionRow, error: latestVersionError } = await supabase
    .from("subscription_plan_versions")
    .select("version_number")
    .eq("template_id", resolvedTemplateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) return errorResponse(500, "INTERNAL_ERROR", latestVersionError.message, correlationId);

  const nextVersionNumber = Number((latestVersionRow as any)?.version_number || 0) + 1;
  const resolvedUnitSize = Math.max(1, nonNegativeInt((templateRow as any).pricing_unit_size, 1));

  const { data: version, error: versionError } = await supabase
    .from("subscription_plan_versions")
    .insert({
      template_id: resolvedTemplateId,
      version_number: nextVersionNumber,
      unit_quota_units: versionInput.unit_quota_units,
      box_quota_units: versionInput.box_quota_units,
      carton_quota_units: versionInput.carton_quota_units,
      pallet_quota_units: versionInput.pallet_quota_units,
      unit_limit: computeFinalQuota(versionInput.unit_quota_units, resolvedUnitSize),
      box_limit: computeFinalQuota(versionInput.box_quota_units, resolvedUnitSize),
      carton_limit: computeFinalQuota(versionInput.carton_quota_units, resolvedUnitSize),
      pallet_limit: computeFinalQuota(versionInput.pallet_quota_units, resolvedUnitSize),
      seat_limit: versionInput.seat_limit,
      plant_limit: versionInput.plant_limit,
      handset_limit: versionInput.handset_limit,
      is_active: publish || versionInput.is_active,
      effective_from: new Date().toISOString(),
      change_note: versionInput.change_note,
    })
    .select("*")
    .single();

  if (versionError) return errorResponse(500, "INTERNAL_ERROR", versionError.message, correlationId);

  if (publish) {
    const { error: deactivateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: false })
      .eq("template_id", resolvedTemplateId)
      .neq("id", (version as any).id);
    if (deactivateError) return errorResponse(500, "INTERNAL_ERROR", deactivateError.message, correlationId);

    const { error: activateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: true })
      .eq("id", (version as any).id);
    if (activateError) return errorResponse(500, "INTERNAL_ERROR", activateError.message, correlationId);
  }

  const currentState = await fetchTemplateWithVersions(supabase, resolvedTemplateId);
  if (!currentState) return errorResponse(500, "INTERNAL_ERROR", "Failed to load updated plan state", correlationId);

  const payload = {
    success: true,
    template: currentState.template,
    active_version: currentState.active_version,
    created_version: currentState.versions.find((row: any) => row.id === (version as any).id) || null,
  };

  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_PLAN_VERSION_CREATED",
    entityType: "subscription_plan_template",
    entityId: resolvedTemplateId,
    beforeState,
    afterState: currentState as unknown as Record<string, unknown>,
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
  const endpoint = "/api/admin/subscription-plans";
  const idempotencyKey = headersList.get("idempotency-key");

  const auth = await requireSuperAdmin();
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);

  const limit = await consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await req.json().catch(() => ({}));
  const templateId = normalizeText((body as any).template_id);
  if (!templateId) return errorResponse(400, "BAD_REQUEST", "template_id is required", correlationId);

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
  const beforeState = await fetchTemplateWithVersions(supabase, templateId);
  if (!beforeState) return errorResponse(404, "NOT_FOUND", "Template not found", correlationId);

  const templateUpdates: Record<string, unknown> = {};
  if ("name" in (body as any)) {
    const name = normalizeText((body as any).name);
    if (!name) return errorResponse(400, "BAD_REQUEST", "name cannot be empty", correlationId);
    templateUpdates.name = name;
  }
  if ("description" in (body as any)) templateUpdates.description = normalizeText((body as any).description) || null;
  if ("billing_cycle" in (body as any)) {
    const billingCycle = normalizeText((body as any).billing_cycle).toLowerCase();
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return errorResponse(400, "BAD_REQUEST", "billing_cycle must be monthly or yearly", correlationId);
    }
    templateUpdates.billing_cycle = billingCycle;
  }
  if ("plan_price" in (body as any)) templateUpdates.plan_price = toPaise((body as any).plan_price);
  if ("razorpay_plan_id" in (body as any)) {
    const razorpayPlanId = normalizeProviderPlanId((body as any).razorpay_plan_id);
    if (!razorpayPlanId) {
      return errorResponse(400, "BAD_REQUEST", "razorpay_plan_id is required", correlationId);
    }
    templateUpdates.razorpay_plan_id = razorpayPlanId;
  }
  if ("pricing_unit_size" in (body as any)) {
    templateUpdates.pricing_unit_size = Math.max(1, nonNegativeInt((body as any).pricing_unit_size, 1));
  }
  if ("is_active" in (body as any)) templateUpdates.is_active = (body as any).is_active === true;

  if (Object.keys(templateUpdates).length > 0) {
    const { error: templateError } = await supabase
      .from("subscription_plan_templates")
      .update(templateUpdates)
      .eq("id", templateId);
    if (templateError) return errorResponse(500, "INTERNAL_ERROR", templateError.message, correlationId);
  }

  const activateVersionId = normalizeText((body as any).activate_version_id);
  if (activateVersionId) {
    const { error: deactivateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: false })
      .eq("template_id", templateId);
    if (deactivateError) return errorResponse(500, "INTERNAL_ERROR", deactivateError.message, correlationId);

    const { error: activateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: true })
      .eq("id", activateVersionId)
      .eq("template_id", templateId);
    if (activateError) return errorResponse(500, "INTERNAL_ERROR", activateError.message, correlationId);
  }

  const currentState = await fetchTemplateWithVersions(supabase, templateId);
  if (!currentState) return errorResponse(500, "INTERNAL_ERROR", "Failed to load updated plan state", correlationId);

  const payload = {
    success: true,
    template: currentState.template,
    active_version: currentState.active_version,
  };

  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: activateVersionId ? "ADMIN_PLAN_VERSION_PUBLISHED" : "ADMIN_PLAN_TEMPLATE_UPDATED",
    entityType: "subscription_plan_template",
    entityId: templateId,
    beforeState: beforeState as unknown as Record<string, unknown>,
    afterState: currentState as unknown as Record<string, unknown>,
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


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
  unit_limit: number;
  box_limit: number;
  carton_limit: number;
  pallet_limit: number;
  seat_limit: number;
  plant_limit: number;
  handset_limit: number;
  grace_unit: number;
  grace_box: number;
  grace_carton: number;
  grace_pallet: number;
  is_active: boolean;
  change_note: string | null;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeVersionInput(input: Record<string, unknown>): PlanVersionInput {
  return {
    unit_limit: nonNegativeInt(input.unit_limit),
    box_limit: nonNegativeInt(input.box_limit),
    carton_limit: nonNegativeInt(input.carton_limit),
    pallet_limit: nonNegativeInt(input.pallet_limit),
    seat_limit: nonNegativeInt(input.seat_limit),
    plant_limit: nonNegativeInt(input.plant_limit),
    handset_limit: nonNegativeInt(input.handset_limit),
    grace_unit: nonNegativeInt(input.grace_unit),
    grace_box: nonNegativeInt(input.grace_box),
    grace_carton: nonNegativeInt(input.grace_carton),
    grace_pallet: nonNegativeInt(input.grace_pallet),
    is_active: input.is_active === true,
    change_note: normalizeText(input.change_note) || null,
  };
}

async function fetchTemplateWithVersions(supabase: ReturnType<typeof getSupabaseAdmin>, templateId: string) {
  const { data: template, error: templateError } = await supabase
    .from("subscription_plan_templates")
    .select("id, name, razorpay_plan_id, billing_cycle, amount_from_razorpay, is_active, updated_at")
    .eq("id", templateId)
    .maybeSingle();

  if (templateError) throw new Error(templateError.message);
  if (!template) return null;

  const { data: versions, error: versionsError } = await supabase
    .from("subscription_plan_versions")
    .select(
      "id, template_id, version_number, unit_limit, box_limit, carton_limit, pallet_limit, seat_limit, plant_limit, handset_limit, grace_unit, grace_box, grace_carton, grace_pallet, is_active, effective_from, effective_to, change_note, created_at"
    )
    .eq("template_id", templateId)
    .order("version_number", { ascending: false });

  if (versionsError) throw new Error(versionsError.message);
  return {
    template,
    versions: versions || [],
    active_version: (versions || []).find((v: any) => v.is_active) || (versions || [])[0] || null,
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
    .select("id, name, razorpay_plan_id, billing_cycle, amount_from_razorpay, is_active, updated_at")
    .order("name", { ascending: true });

  if (templatesError) {
    return errorResponse(500, "INTERNAL_ERROR", templatesError.message, correlationId);
  }

  const templateIds = (templates || []).map((row: any) => row.id);
  const { data: versions, error: versionsError } = templateIds.length
    ? await supabase
        .from("subscription_plan_versions")
        .select(
          "id, template_id, version_number, unit_limit, box_limit, carton_limit, pallet_limit, seat_limit, plant_limit, handset_limit, grace_unit, grace_box, grace_carton, grace_pallet, is_active, effective_from, effective_to, change_note, created_at"
        )
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
    const rows = grouped.get(template.id) || [];
    const activeVersion = rows.find((v) => v.is_active) || rows[0] || null;
    return {
      template,
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

  const limit = consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
  if (!limit.allowed) {
    const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const body = await req.json().catch(() => ({}));
  const templateId = normalizeText((body as any).template_id);
  const templateName = normalizeText((body as any).name);
  const razorpayPlanId = normalizeText((body as any).razorpay_plan_id);
  const billingCycle = normalizeText((body as any).billing_cycle).toLowerCase();
  const amountFromRazorpay = Number((body as any).amount_from_razorpay ?? 0);
  const publish = (body as any).publish !== false;
  const versionInput = normalizeVersionInput(((body as any).version || body) as Record<string, unknown>);

  if (!templateId) {
    if (!templateName || !razorpayPlanId || !["monthly", "yearly"].includes(billingCycle)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "name, razorpay_plan_id, and billing_cycle(monthly|yearly) are required when template_id is not provided",
        correlationId
      );
    }
  }
  if (!Number.isFinite(amountFromRazorpay) || amountFromRazorpay < 0) {
    return errorResponse(400, "BAD_REQUEST", "amount_from_razorpay must be a non-negative number", correlationId);
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
        name: templateName,
        razorpay_plan_id: razorpayPlanId,
        billing_cycle: billingCycle,
        amount_from_razorpay: Math.trunc(amountFromRazorpay),
        is_active: true,
      })
      .select()
      .single();
    if (createTemplateError) return errorResponse(500, "INTERNAL_ERROR", createTemplateError.message, correlationId);
    resolvedTemplateId = String((createdTemplate as any).id);
  } else {
    const current = await fetchTemplateWithVersions(supabase, resolvedTemplateId);
    if (!current) return errorResponse(404, "NOT_FOUND", "Template not found", correlationId);
    beforeState = current as unknown as Record<string, unknown>;
  }

  const { data: latestVersionRow, error: latestVersionError } = await supabase
    .from("subscription_plan_versions")
    .select("version_number")
    .eq("template_id", resolvedTemplateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) return errorResponse(500, "INTERNAL_ERROR", latestVersionError.message, correlationId);

  const nextVersionNumber = Number((latestVersionRow as any)?.version_number || 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from("subscription_plan_versions")
    .insert({
      template_id: resolvedTemplateId,
      version_number: nextVersionNumber,
      ...versionInput,
      is_active: publish || versionInput.is_active,
      effective_from: new Date().toISOString(),
    })
    .select()
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
    created_version: version,
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

  const limit = consumeRateLimit({ key: `admin-mutation:${auth.userId}`, refillPerMinute: 20, burst: 30 });
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
  const templateName = normalizeText((body as any).name);
  const razorpayPlanId = normalizeText((body as any).razorpay_plan_id);
  const billingCycle = normalizeText((body as any).billing_cycle).toLowerCase();
  const amountFromRazorpay = (body as any).amount_from_razorpay;

  if ("name" in (body as any)) templateUpdates.name = templateName;
  if ("razorpay_plan_id" in (body as any)) templateUpdates.razorpay_plan_id = razorpayPlanId;
  if ("billing_cycle" in (body as any)) {
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return errorResponse(400, "BAD_REQUEST", "billing_cycle must be monthly or yearly", correlationId);
    }
    templateUpdates.billing_cycle = billingCycle;
  }
  if ("amount_from_razorpay" in (body as any)) {
    const parsed = Number(amountFromRazorpay);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return errorResponse(400, "BAD_REQUEST", "amount_from_razorpay must be a non-negative number", correlationId);
    }
    templateUpdates.amount_from_razorpay = Math.trunc(parsed);
  }
  if ("is_active" in (body as any)) templateUpdates.is_active = Boolean((body as any).is_active);

  if (Object.keys(templateUpdates).length > 0) {
    const { error: templateUpdateError } = await supabase
      .from("subscription_plan_templates")
      .update(templateUpdates)
      .eq("id", templateId);
    if (templateUpdateError) return errorResponse(500, "INTERNAL_ERROR", templateUpdateError.message, correlationId);
  }

  let createdVersion: Record<string, unknown> | null = null;
  const hasVersionPayload = Boolean((body as any).version);
  const activateVersionId = normalizeText((body as any).activate_version_id);
  const publishNewVersion = (body as any).publish !== false;

  if (Object.keys(templateUpdates).length === 0 && !hasVersionPayload && !activateVersionId) {
    return errorResponse(400, "BAD_REQUEST", "No update fields provided", correlationId);
  }

  if (hasVersionPayload) {
    const versionInput = normalizeVersionInput((body as any).version);
    const nextVersionNumber = Number(beforeState.versions?.[0]?.version_number || 0) + 1;

    const { data: insertedVersion, error: insertVersionError } = await supabase
      .from("subscription_plan_versions")
      .insert({
        template_id: templateId,
        version_number: nextVersionNumber,
        ...versionInput,
        is_active: publishNewVersion || versionInput.is_active,
        effective_from: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertVersionError) return errorResponse(500, "INTERNAL_ERROR", insertVersionError.message, correlationId);
    createdVersion = (insertedVersion || null) as Record<string, unknown> | null;

    if (publishNewVersion) {
      const { error: deactivateError } = await supabase
        .from("subscription_plan_versions")
        .update({ is_active: false })
        .eq("template_id", templateId)
        .neq("id", String((insertedVersion as any).id));
      if (deactivateError) return errorResponse(500, "INTERNAL_ERROR", deactivateError.message, correlationId);

      const { error: activateError } = await supabase
        .from("subscription_plan_versions")
        .update({ is_active: true })
        .eq("id", String((insertedVersion as any).id));
      if (activateError) return errorResponse(500, "INTERNAL_ERROR", activateError.message, correlationId);
    }
  }

  if (activateVersionId) {
    const { data: existingVersion, error: versionLookupError } = await supabase
      .from("subscription_plan_versions")
      .select("id")
      .eq("id", activateVersionId)
      .eq("template_id", templateId)
      .maybeSingle();
    if (versionLookupError) return errorResponse(500, "INTERNAL_ERROR", versionLookupError.message, correlationId);
    if (!existingVersion) return errorResponse(404, "NOT_FOUND", "Version not found for template", correlationId);

    const { error: deactivateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: false })
      .eq("template_id", templateId);
    if (deactivateError) return errorResponse(500, "INTERNAL_ERROR", deactivateError.message, correlationId);

    const { error: activateError } = await supabase
      .from("subscription_plan_versions")
      .update({ is_active: true })
      .eq("id", activateVersionId);
    if (activateError) return errorResponse(500, "INTERNAL_ERROR", activateError.message, correlationId);
  }

  const afterState = await fetchTemplateWithVersions(supabase, templateId);
  if (!afterState) return errorResponse(500, "INTERNAL_ERROR", "Failed to load updated plan state", correlationId);

  const payload = {
    success: true,
    template: afterState.template,
    active_version: afterState.active_version,
    created_version: createdVersion,
  };

  await appendAdminMutationAuditEvent({
    adminId: auth.userId,
    endpoint,
    action: "ADMIN_PLAN_UPDATED",
    entityType: "subscription_plan_template",
    entityId: templateId,
    beforeState: beforeState as unknown as Record<string, unknown>,
    afterState: afterState as unknown as Record<string, unknown>,
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

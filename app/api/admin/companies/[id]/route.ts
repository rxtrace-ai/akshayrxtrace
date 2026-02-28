import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdminRole, requireSuperAdmin } from "@/lib/auth/admin";
import {
  checkAdminIdempotency,
  idempotencyErrorResponse,
} from "@/lib/admin/idempotency";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");
  const companyId = params.id;

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) {
    return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "id, user_id, company_name, gst_number:gst, contact_email:email, contact_phone:phone, address, subscription_status, subscription_plan, trial_started_at, trial_expires_at, extra_user_seats, deleted_at, created_at, updated_at"
    )
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  if (!data) return errorResponse(404, "NOT_FOUND", "Company not found", correlationId);

  return successResponse(200, { success: true, company: data }, correlationId);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const headersList = await headers();
    const correlationId = getOrGenerateCorrelationId(headersList, "admin");
    const companyId = params.id;
    const endpoint = `/api/admin/companies/${companyId}`;
    const idempotencyKey = headersList.get("idempotency-key");

    const auth = await requireSuperAdmin();
    if (auth.error) {
      return errorResponse(403, "FORBIDDEN", "Super admin access required", correlationId);
    }

    const limit = consumeRateLimit({
      key: `admin-mutation:${auth.userId}`,
      refillPerMinute: 20,
      burst: 30,
    });
    if (!limit.allowed) {
      const response = errorResponse(429, "RATE_LIMITED", "Too many mutation requests", correlationId);
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return response;
    }

    const body = await req.json().catch(() => ({}));

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
    if (idempotency.kind === "replay") {
      return successResponse(idempotency.statusCode, idempotency.payload, correlationId);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("admin_company_soft_delete_mutation", {
      p_company_id: companyId,
      p_admin_id: auth.userId,
      p_endpoint: endpoint,
      p_idempotency_key: idempotency.key,
      p_request_hash: idempotency.requestHash,
      p_correlation_id: correlationId,
    });

    if (error) {
      if (error.message?.includes("COMPANY_NOT_FOUND")) {
        return errorResponse(400, "BAD_REQUEST", "Company not found", correlationId);
      }
      if (error.message?.includes("ACTIVE_SUBSCRIPTION_EXISTS")) {
        return errorResponse(409, "CONFLICT", "Cannot delete company with active subscription", correlationId);
      }
      if (error.message?.includes("IDEMPOTENCY_CONFLICT")) {
        return errorResponse(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflict", correlationId);
      }
      return errorResponse(500, "INTERNAL_ERROR", error.message || "Company delete failed", correlationId);
    }

    return successResponse(200, (data || {}) as Record<string, unknown>, correlationId);
  } catch (error: any) {
    const correlationId = getOrGenerateCorrelationId(await headers(), "admin");
    return errorResponse(500, "INTERNAL_ERROR", error?.message || "Company delete failed", correlationId);
  }
}

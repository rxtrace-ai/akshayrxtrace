import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/admin";
import {
  checkAdminIdempotency,
  idempotencyErrorResponse,
} from "@/lib/admin/idempotency";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const headersList = await headers();
    const correlationId = getOrGenerateCorrelationId(headersList, "admin");
    const companyId = params.id;
    const endpoint = `/api/admin/companies/${companyId}/freeze`;
    const idempotencyKey = headersList.get("idempotency-key");

    if (!companyId || !isUuid(companyId)) {
      return errorResponse(400, "BAD_REQUEST", "Invalid company id", correlationId);
    }

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
    const freeze = Boolean((body as any).freeze);
    const reason = String((body as any).reason || "").trim() || null;

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
    if (idempotency.kind === "replay") {
      return successResponse(idempotency.statusCode, idempotency.payload, correlationId);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("admin_company_freeze_mutation", {
      p_company_id: companyId,
      p_admin_id: auth.userId,
      p_endpoint: endpoint,
      p_idempotency_key: idempotency.key,
      p_request_hash: idempotency.requestHash,
      p_correlation_id: correlationId,
      p_freeze: freeze,
      p_reason: reason,
    });

    if (error) {
      if (error.message?.includes("COMPANY_NOT_FOUND")) {
        return errorResponse(400, "BAD_REQUEST", "Company not found", correlationId);
      }
      if (error.message?.includes("AUDIT_COMPANY_ID_NULL")) {
        return errorResponse(500, "INTERNAL_ERROR", "Audit company binding failed", correlationId);
      }
      if (error.message?.includes("IDEMPOTENCY_CONFLICT")) {
        return errorResponse(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflict", correlationId);
      }
      return errorResponse(500, "INTERNAL_ERROR", error.message || "Freeze mutation failed", correlationId);
    }

    return successResponse(200, (data || {}) as Record<string, unknown>, correlationId);
  } catch (error: any) {
    const correlationId = getOrGenerateCorrelationId(await headers(), "admin");
    console.error("Freeze mutation error:", {
      correlationId,
      error,
      message: error?.message,
      stack: error?.stack,
    });
    return errorResponse(500, "INTERNAL_ERROR", error?.message || "Freeze mutation failed", correlationId);
  }
}

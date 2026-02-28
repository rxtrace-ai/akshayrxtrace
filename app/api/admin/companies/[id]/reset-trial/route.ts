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
import { startTrialForCompany } from "@/lib/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const headersList = await headers();
    const correlationId = getOrGenerateCorrelationId(headersList, "admin");
    const companyId = params.id;
    const endpoint = `/api/admin/companies/${companyId}/reset-trial`;
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
    const { data: existingCompany, error: companyErr } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();

    if (companyErr) {
      return errorResponse(500, "INTERNAL_ERROR", companyErr.message || "Failed to validate company", correlationId);
    }
    if (!existingCompany) {
      return errorResponse(404, "NOT_FOUND", "Company not found", correlationId);
    }

    try {
      const trialResult = await startTrialForCompany(supabase, companyId, { force: true });
      if (!trialResult.ok) {
        return errorResponse(409, "CONFLICT", trialResult.error || "Trial reset blocked", correlationId);
      }
      return successResponse(200, { success: true, trial: trialResult.trial }, correlationId);
    } catch (resetError: any) {
      return errorResponse(500, "INTERNAL_ERROR", resetError?.message || "Trial reset failed", correlationId);
    }
  } catch (error: any) {
    const correlationId = getOrGenerateCorrelationId(await headers(), "admin");
    return errorResponse(500, "INTERNAL_ERROR", error?.message || "Trial reset failed", correlationId);
  }
}

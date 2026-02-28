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

function parseBonusField(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: 0 };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, message: "Bonus values must be numeric" };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, message: "Bonus values must be integers" };
  }
  if (value < 0) {
    return { ok: false, message: "Bonus values must be non-negative" };
  }
  return { ok: true, value };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const headersList = await headers();
    const correlationId = getOrGenerateCorrelationId(headersList, "admin");
    const companyId = params.id;
    const endpoint = `/api/admin/companies/${companyId}/bonus-quota`;
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
    const unitRaw = parseBonusField((body as any).unit_bonus);
    const boxRaw = parseBonusField((body as any).box_bonus);
    const cartonRaw = parseBonusField((body as any).carton_bonus);
    const palletRaw = parseBonusField((body as any).pallet_bonus);
    const hardMax = Number(process.env.BONUS_QUOTA_HARD_MAX || "100000000");

    const parseErrors = [unitRaw, boxRaw, cartonRaw, palletRaw].filter((entry) => !entry.ok) as Array<{ ok: false; message: string }>;
    if (parseErrors.length > 0) {
      return errorResponse(400, "BAD_REQUEST", parseErrors[0].message, correlationId);
    }

    const unitBonus = (unitRaw as { ok: true; value: number }).value;
    const boxBonus = (boxRaw as { ok: true; value: number }).value;
    const cartonBonus = (cartonRaw as { ok: true; value: number }).value;
    const palletBonus = (palletRaw as { ok: true; value: number }).value;

    if ([unitBonus, boxBonus, cartonBonus, palletBonus].some((value) => value > hardMax)) {
      return errorResponse(400, "BAD_REQUEST", `Bonus quota exceeds hard max (${hardMax})`, correlationId);
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
    if (idempotency.kind === "replay") {
      return successResponse(idempotency.statusCode, idempotency.payload, correlationId);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("admin_company_bonus_quota_mutation", {
      p_company_id: companyId,
      p_admin_id: auth.userId,
      p_endpoint: endpoint,
      p_idempotency_key: idempotency.key,
      p_request_hash: idempotency.requestHash,
      p_correlation_id: correlationId,
      p_unit_bonus: unitBonus,
      p_box_bonus: boxBonus,
      p_carton_bonus: cartonBonus,
      p_pallet_bonus: palletBonus,
      p_hard_max: hardMax,
    });

    if (error) {
      if (error.message?.includes("COMPANY_NOT_FOUND")) {
        return errorResponse(400, "BAD_REQUEST", "Company not found", correlationId);
      }
      if (error.message?.includes("NEGATIVE_QUOTA_NOT_ALLOWED") || error.message?.includes("INVALID_QUOTA_TYPE")) {
        return errorResponse(400, "BAD_REQUEST", "Bonus values must be non-negative integers", correlationId);
      }
      if (error.message?.includes("QUOTA_HARD_MAX_EXCEEDED")) {
        return errorResponse(400, "BAD_REQUEST", `Bonus quota exceeds hard max (${hardMax})`, correlationId);
      }
      if (error.message?.includes("IDEMPOTENCY_CONFLICT")) {
        return errorResponse(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflict", correlationId);
      }
      return errorResponse(500, "INTERNAL_ERROR", error.message || "Bonus quota allocation failed", correlationId);
    }

    return successResponse(200, (data || {}) as Record<string, unknown>, correlationId);
  } catch (error: any) {
    const correlationId = getOrGenerateCorrelationId(await headers(), "admin");
    return errorResponse(500, "INTERNAL_ERROR", error?.message || "Bonus quota allocation failed", correlationId);
  }
}

import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireAdminRole } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { buildSafeIlikePattern } from "@/lib/api/filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) {
    return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || "20")));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const status = String(url.searchParams.get("status") || "").trim();
  const type = String(url.searchParams.get("import_type") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim();

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("erp_import_sessions")
    .select(
      "id, company_id, actor, import_type, idempotency_key, status, total_rows, validated_rows, imported_rows, duplicate_rows, skipped_rows, invalid_rows, response_status, error_message, created_at, updated_at",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (type) query = query.eq("import_type", type);
  if (q) {
    const pattern = buildSafeIlikePattern(q, 80);
    if (pattern) {
      query = query.or(`company_id.ilike.${pattern},idempotency_key.ilike.${pattern},id.ilike.${pattern}`);
    }
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  }

  return successResponse(
    200,
    {
      success: true,
      page,
      page_size: pageSize,
      total: count || 0,
      rows: data || [],
    },
    correlationId
  );
}

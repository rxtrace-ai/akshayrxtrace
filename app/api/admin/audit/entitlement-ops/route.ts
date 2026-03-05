import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireAdminRole } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse, successResponse } from "@/lib/admin/responses";
import { getOrGenerateCorrelationId } from "@/lib/observability";

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
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") || "25")));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const companyId = String(url.searchParams.get("company_id") || "").trim();
  const requestId = String(url.searchParams.get("request_id") || "").trim();
  const operation = String(url.searchParams.get("operation") || "").trim();

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("entitlement_operation_log")
    .select("id, company_id, operation, request_id, metric, quantity, response_json, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (companyId) query = query.eq("company_id", companyId);
  if (operation) query = query.eq("operation", operation);
  if (requestId) query = query.ilike("request_id", `%${requestId}%`);

  const { data, error, count } = await query.range(from, to);
  if (error) {
    return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  }

  return successResponse(
    200,
    { success: true, page, page_size: pageSize, total: count || 0, rows: data || [] },
    correlationId
  );
}


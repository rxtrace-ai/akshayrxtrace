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
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || "20")));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const status = String(url.searchParams.get("status") || "").trim();
  const type = String(url.searchParams.get("event_type") || "").trim();
  const q = String(url.searchParams.get("q") || "").trim();

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("webhook_events")
    .select(
      "id, event_id, event_type, processing_status, retry_count, received_at, processed_at, error_message, correlation_id",
      { count: "exact" }
    )
    .order("received_at", { ascending: false });

  if (status) query = query.eq("processing_status", status);
  if (type) query = query.ilike("event_type", `%${type}%`);
  if (q) query = query.or(`event_id.ilike.%${q}%,correlation_id.ilike.%${q}%`);

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


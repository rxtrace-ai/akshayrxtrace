import { headers } from "next/headers";
import { requireAdminRole } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();

  const { data: invoices, error } = await supabase
    .from("billing_invoices")
    .select("id, company_id, invoice_type, status, reference, plan, amount, currency, provider_payment_id, issued_at, paid_at, created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    return errorResponse(500, "INTERNAL_ERROR", error.message, correlationId);
  }

  const rows = invoices || [];
  const paidStatuses = new Set(["paid", "captured"]);
  let paidCount = 0;
  let pendingCount = 0;
  let totalAmount = 0;

  for (const row of rows) {
    const status = String((row as any).status || "").trim().toLowerCase();
    const amount = Number((row as any).amount || 0);
    totalAmount += amount;
    if (paidStatuses.has(status)) paidCount += 1;
    else pendingCount += 1;
  }

  return successResponse(
    200,
    {
      success: true,
      summary: {
        total_invoices: rows.length,
        paid_invoices: paidCount,
        pending_invoices: pendingCount,
        total_amount: totalAmount,
      },
      invoices: rows,
    },
    correlationId
  );
}

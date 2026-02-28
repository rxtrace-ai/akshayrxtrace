import { headers } from "next/headers";
import { requireAdminRole } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("company_subscriptions")
    .select(
      "id, company_id, status, current_period_start, current_period_end, next_billing_at, updated_at, plan_template_id, plan_version_id, companies(company_name), subscription_plan_templates(name, billing_cycle, amount_from_razorpay)"
    )
    .order("updated_at", { ascending: false })
    .limit(500);

  if (subscriptionError) {
    return errorResponse(500, "INTERNAL_ERROR", subscriptionError.message, correlationId);
  }

  const { data: invoices, error: invoiceError } = await supabase
    .from("billing_invoices")
    .select(
      "id, company_id, amount, status, currency, created_at, issued_at, paid_at, invoice_pdf_url, provider_invoice_id, provider_subscription_id, invoice_type, companies(company_name)"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (invoiceError) {
    return errorResponse(500, "INTERNAL_ERROR", invoiceError.message, correlationId);
  }

  const totalAmount = (invoices || []).reduce((sum, row: any) => sum + toNumber(row.amount), 0);
  const paidAmount = (invoices || [])
    .filter((row: any) => String(row.status || "").toLowerCase() === "paid")
    .reduce((sum, row: any) => sum + toNumber(row.amount), 0);

  return successResponse(
    200,
    {
      success: true,
      subscriptions: (subscriptions || []).map((row: any) => ({
        id: row.id,
        company_id: row.company_id,
        company_name: row.companies?.company_name ?? null,
        status: row.status,
        current_period_start: row.current_period_start,
        current_period_end: row.current_period_end,
        next_billing_at: row.next_billing_at,
        plan_template_id: row.plan_template_id,
        plan_version_id: row.plan_version_id,
        plan_name: row.subscription_plan_templates?.name ?? null,
        billing_cycle: row.subscription_plan_templates?.billing_cycle ?? null,
        amount_from_razorpay: row.subscription_plan_templates?.amount_from_razorpay ?? 0,
      })),
      invoices: (invoices || []).map((row: any) => ({
        id: row.id,
        company_id: row.company_id,
        company_name: row.companies?.company_name ?? null,
        amount: toNumber(row.amount),
        currency: row.currency || "INR",
        status: row.status,
        invoice_type: row.invoice_type,
        provider_invoice_id: row.provider_invoice_id,
        provider_subscription_id: row.provider_subscription_id,
        invoice_pdf_url: row.invoice_pdf_url,
        created_at: row.created_at,
        issued_at: row.issued_at,
        paid_at: row.paid_at,
      })),
      summary: {
        invoices_count: invoices?.length || 0,
        total_amount: totalAmount,
        paid_amount: paidAmount,
      },
    },
    correlationId
  );
}


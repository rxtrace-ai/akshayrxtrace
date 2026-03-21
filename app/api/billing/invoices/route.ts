import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { data, error } = await owner.supabase
    .from("billing_invoices")
    .select(
      "id, invoice_type, status, reference, plan, amount, base_amount, addons_amount, discount_amount, tax_amount, currency, provider_payment_id, period_start, period_end, issued_at, paid_at, invoice_pdf_url, metadata, created_at"
    )
    .eq("company_id", owner.companyId)
    .order("created_at", { ascending: false });

  if (error) {
    return apiJson({ error: error.message }, { status: 500 });
  }

  return apiJson({
    success: true,
    invoices: (data || []).map((row: any) => {
      const rawPdfUrl = String(row.invoice_pdf_url || "").trim();
      const pdfUrl =
        rawPdfUrl && !rawPdfUrl.startsWith("data:application/pdf;base64,")
          ? rawPdfUrl
          : `/api/billing/invoice/${row.id}/pdf`;
      return {
        ...row,
        invoice_pdf_url: pdfUrl,
      };
    }),
  });
}


import type { SupabaseClient } from "@supabase/supabase-js";
import { renderInvoicePdfBuffer } from "@/lib/billing/invoicePdf";

export async function ensureInvoicePdfForInvoice(params: {
  supabase: SupabaseClient<any>;
  invoiceId: string;
}): Promise<{ ok: boolean; invoice_pdf_url: string | null; generated: boolean; error?: string }> {
  const { supabase, invoiceId } = params;
  const normalizedInvoiceId = String(invoiceId || "").trim();
  if (!normalizedInvoiceId) {
    return { ok: false, invoice_pdf_url: null, generated: false, error: "INVOICE_ID_REQUIRED" };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("id", normalizedInvoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, invoice_pdf_url: null, generated: false, error: invoiceError.message };
  if (!invoice) return { ok: false, invoice_pdf_url: null, generated: false, error: "INVOICE_NOT_FOUND" };

  const existingPdfUrl = String((invoice as any).invoice_pdf_url || "").trim();
  if (existingPdfUrl) {
    return { ok: true, invoice_pdf_url: existingPdfUrl, generated: false };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", (invoice as any).company_id)
    .maybeSingle();
  if (companyError) return { ok: false, invoice_pdf_url: null, generated: false, error: companyError.message };
  if (!company) return { ok: false, invoice_pdf_url: null, generated: false, error: "COMPANY_NOT_FOUND" };

  const pdfBuffer = await renderInvoicePdfBuffer({
    invoice: invoice as any,
    company: {
      id: String((company as any).id),
      company_name: (company as any).company_name || null,
      gst_number: (company as any).gst_number || null,
      contact_email: (company as any).contact_email || (company as any).email || null,
      contact_phone: (company as any).contact_phone || (company as any).phone || null,
      address: (company as any).address || null,
    },
  });

  const pdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
  const { error: updateError } = await supabase
    .from("billing_invoices")
    .update({
      invoice_pdf_url: pdfDataUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", normalizedInvoiceId)
    .is("invoice_pdf_url", null);

  if (updateError) {
    return { ok: false, invoice_pdf_url: null, generated: false, error: updateError.message };
  }

  return { ok: true, invoice_pdf_url: pdfDataUrl, generated: true };
}


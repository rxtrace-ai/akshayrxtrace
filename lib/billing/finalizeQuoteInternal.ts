import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureInvoicePdfForInvoice } from "@/lib/billing/invoiceLifecycle";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/config";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";
import { logError, logInfo } from "@/lib/observability";

export type FinalizeQuoteParams = {
  supabase: SupabaseClient<any>;
  quoteId: string;
  expectedCompanyId?: string;
  expectedUserId?: string;
  correlationId?: string;
};

export type FinalizeQuoteResult = {
  success: true;
  no_op: boolean;
  quote_id: string;
  company_id: string;
  invoice_reference: string;
  invoice_id?: string | null;
  reason?: "already_fulfilled";
};

function toUuidOrNull(value: string | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

async function sendInvoiceEmail(params: {
  supabase: SupabaseClient<any>;
  companyId: string;
  invoiceId: string;
  invoiceReference: string;
  invoicePdfUrl: string | null;
  quoteId: string;
}) {
  const { supabase, companyId, invoiceId, invoiceReference, invoicePdfUrl, quoteId } = params;

  try {
    const { data: company } = await supabase
      .from("companies")
      .select("user_id")
      .eq("id", companyId)
      .maybeSingle();

    const ownerUserId = String((company as any)?.user_id || "").trim();
    if (!ownerUserId) return;

    const admin = getSupabaseAdmin();
    const ownerResult = await admin.auth.admin.getUserById(ownerUserId);
    const ownerEmail = String(ownerResult?.data?.user?.email || "").trim();
    const ownerName =
      String((ownerResult?.data?.user?.user_metadata as any)?.full_name || "").trim() || "there";

    if (!ownerEmail) return;

    const invoiceLink = `${getAppUrl()}/api/billing/invoice/${invoiceId}/pdf`;
    const rawPdf = String(invoicePdfUrl || "");
    const prefix = "data:application/pdf;base64,";
    const attachments =
      rawPdf.startsWith(prefix)
        ? [
            {
              filename: `${invoiceReference.replace(/[^a-zA-Z0-9_.-]/g, "_")}.pdf`,
              contentBase64: rawPdf.slice(prefix.length),
              contentType: "application/pdf",
            },
          ]
        : [];

    await sendTransactionalEmail({
      to: ownerEmail,
      event: "SUBSCRIPTION_PURCHASED",
      payload: {
        user_name: ownerName,
        invoice_link: invoiceLink,
      },
      attachments,
    });
  } catch (emailError: any) {
    logError("SUBSCRIPTION_PURCHASE_EMAIL_FAILED", {
      operation: "finalize_quote_email",
      companyId,
      quote_id: quoteId,
      invoice_id: invoiceId,
      error: String(emailError?.message || "UNKNOWN"),
    });
  }
}

export async function finalizeQuoteInternal(params: FinalizeQuoteParams): Promise<FinalizeQuoteResult> {
  const { supabase, quoteId, expectedCompanyId, expectedUserId, correlationId } = params;
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    throw new Error("QUOTE_ID_REQUIRED");
  }

  logInfo("QUOTE_FINALIZATION_STARTED", {
    operation: "finalize_quote",
    correlationId,
    quote_id: normalizedQuoteId,
    companyId: expectedCompanyId,
    userId: expectedUserId,
  });

  const { data: rpcResult, error: finalizeError } = await supabase.rpc("finalize_paid_quote", {
    p_quote_id: normalizedQuoteId,
    p_expected_company_id: toUuidOrNull(expectedCompanyId),
    p_expected_user_id: toUuidOrNull(expectedUserId),
    p_correlation_id: correlationId || null,
  });

  if (finalizeError) {
    logError("QUOTE_FINALIZATION_RPC_FAILED", {
      operation: "finalize_quote",
      correlationId,
      quote_id: normalizedQuoteId,
      companyId: expectedCompanyId,
      userId: expectedUserId,
      error: finalizeError.message,
    });
    throw new Error(finalizeError.message);
  }

  const result = (rpcResult || {}) as Record<string, any>;
  const companyId = String(result.company_id || "").trim();
  const invoiceReference = String(result.invoice_reference || `quote:${normalizedQuoteId}`).trim();
  const invoiceId = String(result.invoice_id || "").trim() || null;
  const noOp = result.no_op === true;

  if (invoiceId) {
    const pdfResult = await ensureInvoicePdfForInvoice({
      supabase,
      invoiceId,
    }).catch((error: any) => ({
      ok: false,
      invoice_pdf_url: null,
      generated: false,
      error: String(error?.message || "PDF_GENERATION_FAILED"),
    }));

    if (!pdfResult.ok) {
      logError("INVOICE_PDF_GENERATION_FAILED", {
        operation: "finalize_quote_pdf",
        correlationId,
        companyId,
        quote_id: normalizedQuoteId,
        invoice_id: invoiceId,
        error: pdfResult.error || "UNKNOWN",
      });
    }

    await sendInvoiceEmail({
      supabase,
      companyId,
      invoiceId,
      invoiceReference,
      invoicePdfUrl: pdfResult.invoice_pdf_url || null,
      quoteId: normalizedQuoteId,
    });
  }

  logInfo("QUOTE_FINALIZATION_COMPLETED", {
    operation: "finalize_quote",
    correlationId,
    quote_id: normalizedQuoteId,
    companyId,
    invoice_id: invoiceId,
    no_op: noOp,
  });

  return {
    success: true,
    no_op: noOp,
    reason: noOp ? "already_fulfilled" : undefined,
    quote_id: normalizedQuoteId,
    company_id: companyId,
    invoice_reference: invoiceReference,
    invoice_id: invoiceId,
  };
}

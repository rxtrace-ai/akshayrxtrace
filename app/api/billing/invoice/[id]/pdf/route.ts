import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { ensureInvoicePdfForInvoice } from "@/lib/billing/invoiceLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const owner = await requireOwnerContext();
    if (!owner.ok) return owner.response;

    const { id } = params;
    const invoiceId = String(id || "").trim();
    if (!invoiceId) {
      return NextResponse.json({ error: "INVOICE_ID_REQUIRED" }, { status: 400 });
    }

    const { data: invoice, error: readError } = await owner.supabase
      .from("billing_invoices")
      .select("id, company_id, reference, invoice_pdf_url")
      .eq("id", invoiceId)
      .eq("company_id", owner.companyId)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    if (!invoice) return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });

    const pdfEnsure = await ensureInvoicePdfForInvoice({
      supabase: owner.supabase as any,
      invoiceId,
    });
    if (!pdfEnsure.ok || !pdfEnsure.invoice_pdf_url) {
      return NextResponse.json({ error: pdfEnsure.error || "INVOICE_PDF_NOT_AVAILABLE" }, { status: 500 });
    }

    const pdfDataUrl = String(pdfEnsure.invoice_pdf_url || "");
    const dataPrefix = "data:application/pdf;base64,";
    if (!pdfDataUrl.startsWith(dataPrefix)) {
      return NextResponse.redirect(pdfDataUrl, 302);
    }

    const base64 = pdfDataUrl.slice(dataPrefix.length);
    const pdfBuffer = Buffer.from(base64, "base64");
    const filename = `${String((invoice as any).reference || `invoice_${invoiceId}`).replace(/[^a-zA-Z0-9_.-]/g, "_")}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "INVOICE_PDF_DOWNLOAD_FAILED") },
      { status: 500 }
    );
  }
}

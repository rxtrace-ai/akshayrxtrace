import { NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { data: invoices, error } = await owner.supabase
    .from("billing_invoices")
    .select(
      "invoice_type, status, reference, plan, amount, currency, period_start, period_end, due_at, issued_at, paid_at, invoice_pdf_url, created_at"
    )
    .eq("company_id", owner.companyId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    invoices: (invoices || []).map((row: any) => ({
      invoice_type: row.invoice_type,
      status: row.status,
      reference: row.reference,
      plan: row.plan,
      amount: row.amount,
      currency: row.currency,
      period_start: row.period_start,
      period_end: row.period_end,
      due_at: row.due_at,
      issued_at: row.issued_at,
      paid_at: row.paid_at,
      invoice_pdf_url: row.invoice_pdf_url,
      created_at: row.created_at,
    })),
  });
}


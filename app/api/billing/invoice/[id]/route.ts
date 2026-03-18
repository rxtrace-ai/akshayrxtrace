import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { id } = params;
  const invoiceId = String(id || "").trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "INVOICE_ID_REQUIRED" }, { status: 400 });
  }

  const { data, error } = await owner.supabase
    .from("billing_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("company_id", owner.companyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    invoice: data,
  });
}

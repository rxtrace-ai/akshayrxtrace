import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { finalizeQuoteInternal } from "@/lib/billing/finalizeQuoteInternal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const body = await req.json().catch(() => ({}));
    const quoteId = String((body as any)?.quote_id || "").trim();
    if (!quoteId) return NextResponse.json({ error: "quote_id is required" }, { status: 400 });

    const result = await finalizeQuoteInternal({
      supabase: owner.supabase as any,
      quoteId,
      expectedCompanyId: owner.companyId,
      expectedUserId: owner.userId,
      correlationId,
    });

    return NextResponse.json({
      success: true,
      quote_id: result.quote_id,
      invoice_reference: result.invoice_reference,
      no_op: result.no_op,
      correlation_id: correlationId,
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message.includes("PAYMENT_NOT_CAPTURED_YET")) {
      return NextResponse.json({ error: "PAYMENT_NOT_CAPTURED_YET" }, { status: 409 });
    }
    if (message.includes("QUOTE_FORBIDDEN")) {
      return NextResponse.json({ error: "QUOTE_FORBIDDEN" }, { status: 403 });
    }
    if (message.includes("QUOTE_NOT_FOUND")) {
      return NextResponse.json({ error: "QUOTE_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error?.message || "Failed to finalize checkout" },
      { status: 500 }
    );
  }
}

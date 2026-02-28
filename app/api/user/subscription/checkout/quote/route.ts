import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import {
  buildCheckoutQuote,
  loadCheckoutCatalog,
  signCheckoutQuote,
  type CheckoutQuoteInput,
} from "@/lib/billing/userCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const body = await req.json().catch(() => ({}));
    const planTemplateId = String((body as any)?.plan_template_id || "").trim();
    if (!planTemplateId) {
      return NextResponse.json({ error: "plan_template_id is required" }, { status: 400 });
    }

    const catalog = await loadCheckoutCatalog(owner.supabase);
    const quoteInput: CheckoutQuoteInput = {
      companyId: owner.companyId,
      ownerUserId: owner.userId,
      planTemplateId,
      structuralAddons: Array.isArray((body as any)?.structural_addons) ? (body as any).structural_addons : [],
      variableTopups: Array.isArray((body as any)?.variable_topups) ? (body as any).variable_topups : [],
      variableQuota: (body as any)?.variable_quota || undefined,
      couponCode: String((body as any)?.coupon_code || "").trim() || null,
    };

    const quote = buildCheckoutQuote(quoteInput, catalog);
    const signed = signCheckoutQuote(quote);

    return NextResponse.json({
      success: true,
      quote,
      quote_hash: signed.quote_hash,
      quote_signature: signed.signature,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to compute quote");
    if (
      message.includes("PLAN_NOT_AVAILABLE") ||
      message.includes("ADDON_NOT_AVAILABLE") ||
      message.includes("INVALID_STRUCTURAL_ADDON_SELECTION") ||
      message.includes("INVALID_VARIABLE_ADDON_SELECTION") ||
      message.includes("COUPON_INVALID")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("CHECKOUT_SIGNING_SECRET_MISSING")) {
      return NextResponse.json({ error: "Checkout signing secret is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


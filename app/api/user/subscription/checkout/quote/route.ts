import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { resolveActiveCoupon } from "@/lib/billing/coupons";
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
    const planTemplateId = String((body as any)?.plan_template_id || (body as any)?.plan_id || "").trim();
    const couponCode = String((body as any)?.coupon_code || "").trim();
    if (!planTemplateId) {
      return NextResponse.json({ error: "plan_template_id is required" }, { status: 400 });
    }

    const catalog = await loadCheckoutCatalog(owner.supabase);
    const coupon = couponCode ? await resolveActiveCoupon(owner.supabase, couponCode) : null;
    if (couponCode && !coupon) {
      return NextResponse.json({ error: "COUPON_INVALID" }, { status: 400 });
    }

    const genericAddons = Array.isArray((body as any)?.addons) ? (body as any).addons : [];
    const codeAddonsFromGeneric = genericAddons
      .map((entry: any) => ({
        addon_id: String(entry?.addon_id || "").trim(),
        quantity: Math.max(0, Number(entry?.quantity || 0)),
      }))
      .filter((entry: any) => entry.addon_id && entry.quantity > 0);

    const quoteInput: CheckoutQuoteInput = {
      companyId: owner.companyId,
      ownerUserId: owner.userId,
      planTemplateId,
      coupon,
      capacityAddons: Array.isArray((body as any)?.capacity_addons)
        ? (body as any).capacity_addons
        : Array.isArray((body as any)?.structural_addons)
        ? (body as any).structural_addons
        : [],
      codeAddons: Array.isArray((body as any)?.code_addons)
        ? (body as any).code_addons
        : codeAddonsFromGeneric.length
        ? codeAddonsFromGeneric
        : Array.isArray((body as any)?.variable_topups)
        ? (body as any).variable_topups
        : [],
    };

    const quote = buildCheckoutQuote(quoteInput, catalog);
    console.log("ADDONS:", {
      capacity_addons: quote.capacity_addons,
      code_addons: quote.code_addons,
    });
    console.log("DISCOUNT:", quote.totals.discount_paise);
    console.log("QUOTE:", quote);
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
      message.includes("INVALID_CAPACITY_ADDON_SELECTION") ||
      message.includes("INVALID_CODE_ADDON_SELECTION")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes("CHECKOUT_SIGNING_SECRET_MISSING")) {
      return NextResponse.json({ error: "Checkout signing secret is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

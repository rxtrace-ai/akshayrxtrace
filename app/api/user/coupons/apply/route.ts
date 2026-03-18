import { NextRequest, NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { resolveActiveCoupon } from "@/lib/billing/coupons";
import { buildPricingBreakdown } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const body = await req.json().catch(() => ({}));
    const code = String((body as any)?.code || "").trim();
    const subscriptionAmountPaise = Math.max(0, Math.trunc(Number((body as any)?.subscription_amount_paise || 0)));
    const addonsAmountPaise = Math.max(0, Math.trunc(Number((body as any)?.addons_amount_paise || 0)));

    if (!code) {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }

    const coupon = await resolveActiveCoupon(owner.supabase, code);
    if (!coupon) {
      return NextResponse.json({ error: "INVALID_COUPON" }, { status: 400 });
    }

    const pricing = buildPricingBreakdown({
      subscriptionSubtotalPaise: subscriptionAmountPaise,
      addonsSubtotalPaise: addonsAmountPaise,
      coupon,
    });
    const discountAmount = pricing.discount_paise;
    return NextResponse.json({
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
      },
      discount_amount: discountAmount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to apply coupon" },
      { status: 500 }
    );
  }
}

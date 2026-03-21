import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
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
      return apiJson({ error: "code is required" }, { status: 400 });
    }

    const coupon = await resolveActiveCoupon(owner.supabase, code);
    if (!coupon) {
      return apiJson({ error: "INVALID_COUPON" }, { status: 400 });
    }

    const pricing = buildPricingBreakdown({
      subscriptionSubtotalPaise: subscriptionAmountPaise,
      addonsSubtotalPaise: addonsAmountPaise,
      coupon,
    });
    const discountAmount = pricing.discount_paise;
    return apiJson({
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
    return apiJson(
      { error: error?.message || "Failed to apply coupon" },
      { status: 500 }
    );
  }
}


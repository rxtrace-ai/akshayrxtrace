import type { ResolvedCoupon } from "@/lib/billing/coupons";

export type PricingInput = {
  subscriptionSubtotalPaise: number;
  addonsSubtotalPaise: number;
  coupon: ResolvedCoupon | null;
  gstRatePercent?: number;
};

export type PricingBreakdown = {
  currency: "INR";
  subscription_paise: number;
  addons_paise: number;
  discount_paise: number;
  taxable_subtotal_paise: number;
  gst_rate_percent: number;
  gst_paise: number;
  addons_payable_paise: number;
  payable_today_paise: number;
  grand_total_paise: number;
  final_total_paise: number;
};

function normalizePaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

export function buildPricingBreakdown(input: PricingInput): PricingBreakdown {
  const subscriptionSubtotalPaise = normalizePaise(input.subscriptionSubtotalPaise);
  const addonsSubtotalPaise = normalizePaise(input.addonsSubtotalPaise);
  const couponableSubtotalPaise = Math.max(0, subscriptionSubtotalPaise + addonsSubtotalPaise);
  let discountPaise = 0;
  if (input.coupon && couponableSubtotalPaise > 0) {
    if (input.coupon.discount_type === "percentage") {
      const pct = Math.min(Math.max(input.coupon.discount_value, 0), 100);
      discountPaise = Math.min(couponableSubtotalPaise, Math.round((couponableSubtotalPaise * pct) / 100));
    } else {
      discountPaise = Math.min(couponableSubtotalPaise, Math.max(0, Math.trunc(input.coupon.discount_value)));
    }
    if (input.coupon.maxDiscountPaise !== null) {
      discountPaise = Math.min(discountPaise, Math.max(0, input.coupon.maxDiscountPaise));
    }
  }
  const discountedTotalPaise = Math.max(0, couponableSubtotalPaise - discountPaise);
  const addonsPayablePaise = Math.max(0, Math.min(addonsSubtotalPaise, discountedTotalPaise));
  const taxableSubtotalPaise = discountedTotalPaise;
  const gstRatePercent = Number.isFinite(input.gstRatePercent) ? Number(input.gstRatePercent) : 18;
  const gstPaise = Math.max(0, Math.round((taxableSubtotalPaise * gstRatePercent) / 100));
  const finalTotalPaise = taxableSubtotalPaise + gstPaise;

  if (finalTotalPaise <= 0) {
    throw new Error("FINAL_TOTAL_MUST_BE_GREATER_THAN_ZERO");
  }

  return {
    currency: "INR",
    subscription_paise: subscriptionSubtotalPaise,
    addons_paise: addonsSubtotalPaise,
    discount_paise: discountPaise,
    taxable_subtotal_paise: taxableSubtotalPaise,
    gst_rate_percent: gstRatePercent,
    gst_paise: gstPaise,
    addons_payable_paise: addonsPayablePaise,
    payable_today_paise: finalTotalPaise,
    grand_total_paise: finalTotalPaise,
    final_total_paise: finalTotalPaise,
  };
}

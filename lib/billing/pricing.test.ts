import { describe, expect, it } from "vitest";
import { buildPricingBreakdown } from "@/lib/billing/pricing";

describe("buildPricingBreakdown", () => {
  it("applies coupon discount across the full eligible subtotal", () => {
    const pricing = buildPricingBreakdown({
      subscriptionSubtotalPaise: 10_000,
      addonsSubtotalPaise: 5_000,
      coupon: {
        id: "coupon-1",
        code: "SAVE10",
        discount_type: "percentage",
        discount_value: 10,
        maxDiscountPaise: null,
        active: true,
        valid_from: null,
        valid_until: null,
        usage_limit: null,
        used_count: 0,
      },
    });

    expect(pricing.discount_paise).toBe(1_500);
    expect(pricing.taxable_subtotal_paise).toBe(13_500);
    expect(pricing.gst_paise).toBe(2_430);
    expect(pricing.final_total_paise).toBe(15_930);
  });

  it("caps flat discounts so totals never go below zero", () => {
    const pricing = buildPricingBreakdown({
      subscriptionSubtotalPaise: 5_000,
      addonsSubtotalPaise: 2_000,
      coupon: {
        id: "coupon-2",
        code: "FLAT5000",
        discount_type: "flat",
        discount_value: 5_000,
        maxDiscountPaise: null,
        active: true,
        valid_from: null,
        valid_until: null,
        usage_limit: null,
        used_count: 0,
      },
    });

    expect(pricing.discount_paise).toBe(5_000);
    expect(pricing.taxable_subtotal_paise).toBe(2_000);
  });

  it("rejects zero-value final totals", () => {
    expect(() =>
      buildPricingBreakdown({
        subscriptionSubtotalPaise: 0,
        addonsSubtotalPaise: 1_000,
        coupon: {
          id: "coupon-3",
          code: "FREE100",
          discount_type: "percentage",
          discount_value: 100,
          maxDiscountPaise: null,
          active: true,
          valid_from: null,
          valid_until: null,
          usage_limit: null,
          used_count: 0,
        },
      })
    ).toThrow("FINAL_TOTAL_MUST_BE_GREATER_THAN_ZERO");
  });
});

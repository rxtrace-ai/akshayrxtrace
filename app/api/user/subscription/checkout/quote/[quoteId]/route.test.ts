import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  quote: null as any,
}));

vi.mock("@/lib/billing/userSubscriptionAuth", () => ({
  requireOwnerContext: async () => {
    const supabase: any = {
      from: (table: string) => {
        if (table === "quotes") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: mockState.quote, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    return {
      ok: true,
      userId: "owner-1",
      companyId: "company-1",
      companyName: "RxTrace Co",
      userEmail: "owner@rxtrace.in",
      supabase,
    };
  },
}));

describe("GET /api/user/subscription/checkout/quote/[quoteId]", () => {
  beforeEach(() => {
    mockState.quote = {
      id: "quote-1",
      status: "active",
      expires_at: "2099-01-01T00:00:00.000Z",
      currency: "INR",
      plan_id: "plan-1",
      plan_snapshot_json: {
        name: "Growth",
        billing_cycle: "monthly",
        plan_price_paise: 129900,
        pricing_unit_size: 1000,
        quotas: { unit: 1000 },
        capacities: { seat: 5, plant: 1, handset: 2 },
      },
      coupon_snapshot_json: {
        id: "coupon-1",
        code: "SAVE10",
        discount_type: "percentage",
        discount_value: 10,
        max_discount_paise: 5000,
        discount_paise: 1500,
      },
      addons_json: {
        capacity_addons: [
          {
            addon_id: "addon-cap-1",
            name: "Extra Seats",
            entitlement_key: "seat",
            quantity: 2,
            duration_days: 30,
            allocated_capacity: 2,
            unit_price_paise: 2500,
            line_total_paise: 5000,
          },
        ],
        code_addons: [
          {
            addon_id: "addon-code-1",
            name: "Unit Codes",
            entitlement_key: "unit",
            quantity: 1,
            pricing_unit_size: 500,
            allocated_quota: 500,
            unit_price_paise: 1000,
            line_total_paise: 1000,
          },
        ],
      },
      totals_snapshot_json: {
        subscription_paise: 129900,
        capacity_addons_paise: 5000,
        code_addons_paise: 1000,
        addons_paise: 6000,
        discount_paise: 1500,
        taxable_subtotal_paise: 134400,
        gst_rate_percent: 18,
        gst_paise: 24192,
        final_total_paise: 158592,
      },
    };
  });

  it("returns quote-backed checkout data for the dedicated checkout page", async () => {
    const { GET } = await import("@/app/api/user/subscription/checkout/quote/[quoteId]/route");

    const res = await GET(new Request("http://localhost") as any, {
      params: Promise.resolve({ quoteId: "quote-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.quote.purchase_type).toBe("subscription");
    expect(json.quote.selected_plan_template_id).toBe("plan-1");
    expect(json.quote.coupon.code).toBe("SAVE10");
    expect(json.quote.addons_snapshot.capacity_addons[0].duration_days).toBe(30);
    expect(json.quote.totals.capacity_addons_paise).toBe(5000);
    expect(json.quote.totals.code_addons_paise).toBe(1000);
  });

  it("classifies add-on only quotes correctly", async () => {
    mockState.quote = {
      ...mockState.quote,
      plan_id: null,
      plan_snapshot_json: {},
      coupon_snapshot_json: {},
      addons_json: {
        capacity_addons: [],
        code_addons: [
          {
            addon_id: "addon-code-1",
            name: "Unit Codes",
            entitlement_key: "unit",
            quantity: 2,
            pricing_unit_size: 500,
            allocated_quota: 1000,
            unit_price_paise: 1000,
            line_total_paise: 2000,
          },
        ],
      },
      totals_snapshot_json: {
        subscription_paise: 0,
        capacity_addons_paise: 0,
        code_addons_paise: 2000,
        addons_paise: 2000,
        discount_paise: 0,
        taxable_subtotal_paise: 2000,
        gst_rate_percent: 18,
        gst_paise: 360,
        final_total_paise: 2360,
      },
    };

    const { GET } = await import("@/app/api/user/subscription/checkout/quote/[quoteId]/route");
    const res = await GET(new Request("http://localhost") as any, {
      params: Promise.resolve({ quoteId: "quote-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.quote.checkout_mode).toBe("one_time_addon");
    expect(json.quote.purchase_type).toBe("code_topup");
    expect(json.quote.plan_snapshot).toBeNull();
    expect(json.quote.coupon).toBeNull();
  });

  it("marks active quotes as expired when the expiry timestamp has already passed", async () => {
    mockState.quote = {
      ...mockState.quote,
      status: "active",
      expires_at: "2000-01-01T00:00:00.000Z",
    };

    const { GET } = await import("@/app/api/user/subscription/checkout/quote/[quoteId]/route");
    const res = await GET(new Request("http://localhost") as any, {
      params: Promise.resolve({ quoteId: "quote-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.quote_status).toBe("expired");
  });
});

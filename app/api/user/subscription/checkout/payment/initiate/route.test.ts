import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  quote: null as any,
  existingIntent: null as any,
  planTemplate: null as any,
  savedIntent: { id: "pi-1", provider_subscription_id: "sub_123", razorpay_order_id: "order_123" } as any,
  createdSubscription: { id: "sub_123", customer_id: "cust_123" } as any,
  updatedQuoteStatus: null as string | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("razorpay", () => ({
  default: class Razorpay {
    orders = {
      create: async () => ({ id: "order_live_1" }),
    };
  },
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
            update: (payload: any) => ({
              eq: () => ({
                eq: async () => {
                  mockState.updatedQuoteStatus = payload.status;
                  return { error: null };
                },
              }),
            }),
          };
        }
        if (table === "payment_intents") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockState.existingIntent, error: null }),
              }),
            }),
            upsert: () => ({
              select: () => ({
                single: async () => ({ data: mockState.savedIntent, error: null }),
              }),
            }),
          };
        }
        if (table === "subscription_plan_templates") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockState.planTemplate, error: null }),
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

vi.mock("@/lib/billing/razorpaySubscriptions", () => ({
  createRazorpaySubscription: async () => mockState.createdSubscription,
  getRazorpayPublishableKey: () => "rzp_test_key",
  getRazorpaySubscriptionTotalCount: () => 12,
}));

describe("POST /api/user/subscription/checkout/payment/initiate", () => {
  beforeEach(() => {
    vi.stubEnv("RAZORPAY_KEY_ID", "test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "test_secret");
    mockState.quote = {
      id: "quote-1",
      company_id: "company-1",
      user_id: "owner-1",
      status: "active",
      expires_at: "2099-01-01T00:00:00.000Z",
      currency: "INR",
      plan_id: "plan-template-1",
      plan_snapshot_json: { name: "Growth", billing_cycle: "monthly" },
      totals_snapshot_json: { final_total_paise: 99900 },
      addons_json: {},
    };
    mockState.existingIntent = null;
    mockState.planTemplate = {
      id: "plan-template-1",
      name: "Growth",
      billing_cycle: "monthly",
      razorpay_plan_id: "plan_live_123",
    };
    mockState.savedIntent = { id: "pi-1", provider_subscription_id: "sub_123", razorpay_order_id: "order_123" };
    mockState.createdSubscription = { id: "sub_123", customer_id: "cust_123" };
    mockState.updatedQuoteStatus = null;
  });

  it("rejects recurring plan checkout when add-ons are mixed into the same quote", async () => {
    mockState.quote = {
      ...mockState.quote,
      addons_json: {
        capacity_addons: [{ addon_id: "addon-1", quantity: 1 }],
        code_addons: [],
      },
    };

    const { POST } = await import("@/app/api/user/subscription/checkout/payment/initiate/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/payment/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("RECURRING_PLAN_ADDON_SPLIT_REQUIRED");
  });

  it("creates a Razorpay subscription for recurring plan checkout", async () => {
    const { POST } = await import("@/app/api/user/subscription/checkout/payment/initiate/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/payment/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.checkout_mode).toBe("recurring_plan");
    expect(json.subscription_id).toBe("sub_123");
    expect(json.razorpay.subscription_id).toBe("sub_123");
    expect(mockState.updatedQuoteStatus).toBe("pending_payment");
  });

  it("replays existing one-time add-on orders instead of creating a new order", async () => {
    mockState.quote = {
      ...mockState.quote,
      plan_id: null,
      plan_snapshot_json: {},
      totals_snapshot_json: { final_total_paise: 2500 },
    };
    mockState.existingIntent = { id: "pi-addon-1", razorpay_order_id: "order_existing_1" };

    const { POST } = await import("@/app/api/user/subscription/checkout/payment/initiate/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/payment/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.replay).toBe(true);
    expect(json.checkout_mode).toBe("one_time_addon");
    expect(json.order_id).toBe("order_existing_1");
  });
});

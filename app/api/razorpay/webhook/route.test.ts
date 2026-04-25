import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  headerStore: new Headers(),
  paymentIntentBySubscription: {
    id: "pi-sub-1",
    quote_id: "quote-1",
    provider_subscription_id: "sub_123",
    provider_customer_id: "cust_123",
    status: "created",
    razorpay_payment_id: null,
  } as any,
  quoteRow: {
    id: "quote-1",
    company_id: "company-1",
    user_id: "owner-1",
    plan_id: "plan-1",
    plan_snapshot_json: { billing_cycle: "monthly" },
    status: "pending_payment",
    fulfilled_at: null,
  } as any,
  existingSubscription: null as any,
  orderPaymentIntent: {
    quote_id: "quote-1",
  } as any,
  rpcDuplicate: false,
  finalizeCalls: [] as any[],
  paymentIntentUpdates: [] as any[],
  subscriptionUpdates: [] as any[],
  subscriptionInserts: [] as any[],
  captureMode: "already_captured" as "already_captured" | "captured",
}));

vi.mock("next/headers", () => ({
  headers: async () => mockState.headerStore,
}));

vi.mock("@/lib/security/rateLimit", () => ({
  consumeRateLimit: async () => ({
    allowed: true,
    retryAfterSeconds: 0,
  }),
}));

vi.mock("@/lib/billing/finalizeQuoteInternal", () => ({
  finalizeQuoteInternal: async (params: any) => {
    mockState.finalizeCalls.push(params);
    return {
      success: true,
      quote_id: params.quoteId,
      invoice_reference: `quote:${params.quoteId}`,
      no_op: true,
    };
  },
}));

vi.mock("@/lib/observability", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

vi.mock("@/lib/billing/razorpaySubscriptions", () => ({
  fetchRazorpaySubscription: async () => ({
    id: "sub_123",
    customer_id: "cust_123",
    current_start: 1711497600,
    current_end: 1714089600,
    charge_at: 1714089600,
  }),
  mapRazorpaySubscriptionStatusToLocal: (value: string) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (["active", "authenticated", "activated", "charged"].includes(normalized)) return "active";
    if (normalized === "payment_failed") return "payment_failed";
    return normalized || "pending";
  },
  toIsoFromUnix: (value: number | null | undefined) =>
    typeof value === "number" ? new Date(value * 1000).toISOString() : null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => {
    const supabase: any = {
      from: (table: string) => {
        if (table === "payment_intents") {
          return {
            select: () => ({
              eq: (_column: string, value: string) => ({
                maybeSingle: async () => {
                  if (value === "sub_123") {
                    return { data: mockState.paymentIntentBySubscription, error: null };
                  }
                  if (value === "order_123") {
                    return { data: mockState.orderPaymentIntent, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
            update: (payload: any) => ({
              eq: async () => {
                mockState.paymentIntentUpdates.push(payload);
                return { error: null };
              },
            }),
          };
        }

        if (table === "quotes") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockState.quoteRow, error: null }),
              }),
            }),
          };
        }

        if (table === "company_subscriptions") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: mockState.existingSubscription, error: null }),
                  }),
                }),
              }),
            }),
            update: (payload: any) => ({
              eq: async () => {
                mockState.subscriptionUpdates.push(payload);
                return { error: null };
              },
            }),
            insert: async (payload: any) => {
              mockState.subscriptionInserts.push(payload);
              return { error: null };
            },
          };
        }

        if (table === "razorpay_orders") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }

        if (table === "company_trials") {
          return {
            upsert: () => ({
              select: async () => ({ data: [], error: null }),
            }),
          };
        }

        if (table === "quota_allocations") {
          return {
            insert: async () => ({ error: null }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
      rpc: async (name: string, params: any) => {
        if (name === "process_payment_intent_capture") {
          if (mockState.captureMode === "already_captured") {
            return { data: null, error: { message: "PAYMENT_INTENT_ALREADY_CAPTURED" } };
          }
          return { data: { quote_id: "quote-1" }, error: null };
        }

        if (name === "process_razorpay_webhook_event") {
          return { data: { duplicate: mockState.rpcDuplicate }, error: null };
        }

        throw new Error(`Unexpected rpc ${name}`);
      },
    };

    return supabase;
  },
}));

function signPayload(payload: string) {
  return crypto.createHmac("sha256", "test_webhook_secret").update(payload).digest("hex");
}

describe("POST /api/razorpay/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "test_webhook_secret");
    mockState.headerStore = new Headers();
    mockState.paymentIntentBySubscription = {
      id: "pi-sub-1",
      quote_id: "quote-1",
      provider_subscription_id: "sub_123",
      provider_customer_id: "cust_123",
      status: "created",
      razorpay_payment_id: null,
    };
    mockState.quoteRow = {
      id: "quote-1",
      company_id: "company-1",
      user_id: "owner-1",
      plan_id: "plan-1",
      plan_snapshot_json: { billing_cycle: "monthly" },
      status: "pending_payment",
      fulfilled_at: null,
    };
    mockState.existingSubscription = null;
    mockState.orderPaymentIntent = { quote_id: "quote-1" };
    mockState.rpcDuplicate = false;
    mockState.finalizeCalls = [];
    mockState.paymentIntentUpdates = [];
    mockState.subscriptionUpdates = [];
    mockState.subscriptionInserts = [];
    mockState.captureMode = "already_captured";
  });

  it("returns duplicate=true for replayed payment capture and remains safe", async () => {
    const event = {
      event: "payment.captured",
      created_at: 1711497600,
      payload: {
        payment: {
          entity: {
            id: "pay_123",
            order_id: "order_123",
            amount: 99900,
            notes: {
              correlation_id: "corr_dup",
            },
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    mockState.rpcDuplicate = true;
    mockState.headerStore = new Headers({
      "x-razorpay-signature": signPayload(payload),
      "x-razorpay-event-id": "evt_duplicate_1",
    });

    const { POST } = await import("@/app/api/razorpay/webhook/route");
    const req = new Request("http://localhost/api/razorpay/webhook", {
      method: "POST",
      body: payload,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.duplicate).toBe(true);
    expect(mockState.finalizeCalls).toHaveLength(0);
  });

  it("syncs subscription.authenticated without activating the quote", async () => {
    const event = {
      event: "subscription.authenticated",
      created_at: 1711497600,
      payload: {
        subscription: {
          entity: {
            id: "sub_123",
            status: "authenticated",
            customer_id: "cust_123",
            current_start: 1711497600,
            current_end: 1714089600,
            charge_at: 1714089600,
            notes: {
              correlation_id: "corr_authenticated",
            },
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    mockState.headerStore = new Headers({
      "x-razorpay-signature": signPayload(payload),
      "x-razorpay-event-id": "evt_authenticated_1",
    });

    const { POST } = await import("@/app/api/razorpay/webhook/route");
    const req = new Request("http://localhost/api/razorpay/webhook", {
      method: "POST",
      body: payload,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockState.finalizeCalls).toHaveLength(0);
    expect(mockState.paymentIntentUpdates).toHaveLength(0);
    expect(mockState.subscriptionInserts).toHaveLength(1);
    expect(mockState.subscriptionInserts[0]).toMatchObject({
      company_id: "company-1",
      status: "active",
      provider_subscription_id: "sub_123",
    });
  });

  it("finalizes the quote only after invoice.paid and keeps replay safe", async () => {
    const event = {
      event: "invoice.paid",
      created_at: 1711497600,
      payload: {
        invoice: {
          entity: {
            id: "inv_paid_1",
            subscription_id: "sub_123",
            payment_id: "pay_paid_1",
            amount: 99900,
            period_start: 1711497600,
            period_end: 1714089600,
            notes: {
              correlation_id: "corr_invoice_paid",
            },
          },
        },
      },
    };
    const payload = JSON.stringify(event);

    mockState.headerStore = new Headers({
      "x-razorpay-signature": signPayload(payload),
      "x-razorpay-event-id": "evt_invoice_paid_1",
    });

    const { POST } = await import("@/app/api/razorpay/webhook/route");
    const firstReq = new Request("http://localhost/api/razorpay/webhook", {
      method: "POST",
      body: payload,
    });
    const firstRes = await POST(firstReq);
    const firstJson = await firstRes.json();

    expect(firstRes.status).toBe(200);
    expect(firstJson.ok).toBe(true);
    expect(mockState.finalizeCalls).toHaveLength(1);
    expect(mockState.finalizeCalls[0].quoteId).toBe("quote-1");
    expect(mockState.paymentIntentUpdates).toHaveLength(1);
    expect(mockState.paymentIntentUpdates[0]).toMatchObject({
      status: "paid",
      provider_subscription_id: "sub_123",
      razorpay_payment_id: "pay_paid_1",
    });

    mockState.rpcDuplicate = true;
    mockState.headerStore = new Headers({
      "x-razorpay-signature": signPayload(payload),
      "x-razorpay-event-id": "evt_invoice_paid_1",
    });

    const replayReq = new Request("http://localhost/api/razorpay/webhook", {
      method: "POST",
      body: payload,
    });
    const replayRes = await POST(replayReq);
    const replayJson = await replayRes.json();

    expect(replayRes.status).toBe(200);
    expect(replayJson.ok).toBe(true);
    expect(replayJson.duplicate).toBe(true);
    expect(mockState.finalizeCalls).toHaveLength(1);
    expect(mockState.paymentIntentUpdates).toHaveLength(1);
  });

  it("handles out-of-order invoice.payment_failed without finalizing the quote", async () => {
    const event = {
      event: "invoice.payment_failed",
      created_at: 1711497600,
      payload: {
        invoice: {
          entity: {
            id: "inv_123",
            subscription_id: "sub_123",
            payment_id: "pay_failed_1",
            amount: 99900,
            period_start: 1711497600,
            period_end: 1714089600,
            notes: {
              correlation_id: "corr_failed",
            },
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    mockState.headerStore = new Headers({
      "x-razorpay-signature": signPayload(payload),
      "x-razorpay-event-id": "evt_failed_1",
    });

    const { POST } = await import("@/app/api/razorpay/webhook/route");
    const req = new Request("http://localhost/api/razorpay/webhook", {
      method: "POST",
      body: payload,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.duplicate).toBe(false);
    expect(mockState.finalizeCalls).toHaveLength(0);
    expect(mockState.paymentIntentUpdates).toHaveLength(1);
    expect(mockState.paymentIntentUpdates[0]).toMatchObject({
      status: "payment_failed",
      provider_subscription_id: "sub_123",
    });
    expect(mockState.subscriptionInserts).toHaveLength(1);
    expect(mockState.subscriptionInserts[0]).toMatchObject({
      company_id: "company-1",
      status: "payment_failed",
      provider_subscription_id: "sub_123",
    });
  });
});

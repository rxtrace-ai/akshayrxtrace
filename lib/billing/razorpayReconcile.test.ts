import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  intents: [] as any[],
  quotes: [] as any[],
  subscriptions: [] as any[],
  paymentIntentUpdates: [] as any[],
  subscriptionUpdates: [] as any[],
  rpcCalls: [] as any[],
  finalizeCalls: [] as any[],
  orderPayments: [] as any[],
  orderEntity: { id: "order_123", status: "created" } as any,
  subscriptionEntity: {
    id: "sub_123",
    status: "authenticated",
    customer_id: "cust_123",
    current_start: 1711497600,
    current_end: 1714089600,
    charge_at: 1714089600,
  } as any,
  subscriptionInvoices: [] as any[],
}));

vi.mock("@/lib/billing/finalizeQuoteInternal", () => ({
  finalizeQuoteInternal: async (params: any) => {
    mockState.finalizeCalls.push(params);
    const quote = mockState.quotes.find((row) => row.id === params.quoteId);
    if (quote) {
      quote.fulfilled_at = quote.fulfilled_at || new Date().toISOString();
      quote.status = "fulfilled";
    }
    return {
      success: true,
      quote_id: params.quoteId,
      invoice_reference: `quote:${params.quoteId}`,
      no_op: mockState.finalizeCalls.length > 1,
    };
  },
}));

vi.mock("@/lib/billing/razorpaySubscriptions", () => ({
  fetchRazorpayOrder: async () => mockState.orderEntity,
  fetchRazorpayPaymentsForOrder: async () => mockState.orderPayments,
  fetchRazorpaySubscription: async () => mockState.subscriptionEntity,
  fetchRazorpayInvoicesForSubscription: async () => mockState.subscriptionInvoices,
  mapRazorpaySubscriptionStatusToLocal: (value: string) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (["active", "authenticated", "activated", "charged"].includes(normalized)) return "active";
    if (normalized === "cancelled") return "cancelled";
    if (normalized === "expired") return "expired";
    return normalized || "pending";
  },
  toIsoFromUnix: (value: number | null | undefined) =>
    typeof value === "number" ? new Date(value * 1000).toISOString() : null,
}));

function createSupabaseMock() {
  return {
    from(table: string) {
      if (table === "payment_intents") {
        return {
          select: () => ({
            in: (_column: string, statuses: string[]) => ({
              order: () => ({
                limit: async () => ({
                  data: mockState.intents.filter((intent) => statuses.includes(String(intent.status || ""))),
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: async (_column: string, value: string) => {
              mockState.paymentIntentUpdates.push({ id: value, ...payload });
              const row = mockState.intents.find((intent) => intent.id === value);
              if (row) Object.assign(row, payload);
              return { error: null };
            },
          }),
        };
      }

      if (table === "quotes") {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: mockState.quotes.filter((quote) => ids.includes(quote.id)),
              error: null,
            }),
          }),
        };
      }

      if (table === "company_subscriptions") {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: mockState.subscriptions, error: null }),
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: async (_column: string, value: string) => {
              mockState.subscriptionUpdates.push({ id: value, ...payload });
              const row = mockState.subscriptions.find((subscription) => subscription.id === value);
              if (row) Object.assign(row, payload);
              return { error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
    rpc: async (name: string, params: any) => {
      mockState.rpcCalls.push({ name, params });

      if (name === "process_payment_intent_capture") {
        const intent = mockState.intents.find((row) => row.razorpay_order_id === params.p_razorpay_order_id);
        if (intent) {
          intent.status = "paid";
          intent.razorpay_payment_id = params.p_razorpay_payment_id;
        }
        return {
          data: {
            quote_id: intent?.quote_id ?? "quote-1",
          },
          error: null,
        };
      }

      throw new Error(`Unexpected rpc ${name}`);
    },
  } as any;
}

describe("reconcileRazorpayPayments", () => {
  beforeEach(() => {
    mockState.intents = [];
    mockState.quotes = [];
    mockState.subscriptions = [];
    mockState.paymentIntentUpdates = [];
    mockState.subscriptionUpdates = [];
    mockState.rpcCalls = [];
    mockState.finalizeCalls = [];
    mockState.orderPayments = [];
    mockState.orderEntity = { id: "order_123", status: "created" };
    mockState.subscriptionEntity = {
      id: "sub_123",
      status: "authenticated",
      customer_id: "cust_123",
      current_start: 1711497600,
      current_end: 1714089600,
      charge_at: 1714089600,
    };
    mockState.subscriptionInvoices = [];
  });

  it("recovers a pending add-on order from a captured payment exactly once", async () => {
    mockState.intents = [
      {
        id: "pi-order-1",
        quote_id: "quote-order-1",
        status: "created",
        razorpay_order_id: "order_123",
        provider_subscription_id: null,
        created_at: "2026-04-25T00:00:00.000Z",
      },
    ];
    mockState.quotes = [
      {
        id: "quote-order-1",
        company_id: "company-1",
        user_id: "owner-1",
        status: "pending_payment",
        fulfilled_at: null,
      },
    ];
    mockState.orderPayments = [
      {
        id: "pay_order_1",
        status: "captured",
        amount: 149900,
        order_id: "order_123",
      },
    ];

    const { reconcileRazorpayPayments } = await import("@/lib/billing/razorpayReconcile");
    const result = await reconcileRazorpayPayments({
      supabase: createSupabaseMock(),
      correlationId: "corr-order-1",
    });

    expect(result.checked).toBe(1);
    expect(result.repaired).toContainEqual(
      expect.objectContaining({
        payment_intent_id: "pi-order-1",
        quote_id: "quote-order-1",
        recovered_via: "payment.captured",
      })
    );
    expect(mockState.rpcCalls).toContainEqual(
      expect.objectContaining({
        name: "process_payment_intent_capture",
      })
    );
    expect(mockState.finalizeCalls).toHaveLength(1);

    const replay = await reconcileRazorpayPayments({
      supabase: createSupabaseMock(),
      correlationId: "corr-order-2",
    });
    expect(replay.checked).toBe(0);
    expect(replay.repaired).toHaveLength(0);
    expect(mockState.finalizeCalls).toHaveLength(1);
  });

  it("recovers a pending subscription only after a paid invoice exists and keeps replay safe", async () => {
    mockState.intents = [
      {
        id: "pi-sub-1",
        quote_id: "quote-sub-1",
        status: "created",
        razorpay_order_id: null,
        provider_subscription_id: "sub_123",
        created_at: "2026-04-25T00:00:00.000Z",
      },
    ];
    mockState.quotes = [
      {
        id: "quote-sub-1",
        company_id: "company-1",
        user_id: "owner-1",
        status: "pending_payment",
        fulfilled_at: null,
      },
    ];
    mockState.subscriptionInvoices = [
      {
        id: "inv_123",
        status: "paid",
        payment_id: "pay_sub_1",
        subscription_id: "sub_123",
        paid_at: 1711497600,
      },
    ];

    const { reconcileRazorpayPayments } = await import("@/lib/billing/razorpayReconcile");
    const result = await reconcileRazorpayPayments({
      supabase: createSupabaseMock(),
      correlationId: "corr-sub-1",
    });

    expect(result.repaired).toContainEqual(
      expect.objectContaining({
        payment_intent_id: "pi-sub-1",
        quote_id: "quote-sub-1",
        provider_subscription_id: "sub_123",
        recovered_via: "invoice.paid",
      })
    );
    expect(mockState.paymentIntentUpdates).toContainEqual(
      expect.objectContaining({
        id: "pi-sub-1",
        status: "paid",
        razorpay_payment_id: "pay_sub_1",
      })
    );
    expect(mockState.finalizeCalls).toHaveLength(1);

    const replay = await reconcileRazorpayPayments({
      supabase: createSupabaseMock(),
      correlationId: "corr-sub-2",
    });
    expect(replay.checked).toBe(0);
    expect(replay.repaired).toHaveLength(0);
    expect(mockState.finalizeCalls).toHaveLength(1);
  });
});

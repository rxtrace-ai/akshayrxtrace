import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  ownerOk: true,
  finalizeResult: {
    quote_id: "quote-1",
    invoice_reference: "quote:quote-1",
    no_op: false,
  } as any,
  finalizeError: null as Error | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/billing/userSubscriptionAuth", () => ({
  requireOwnerContext: async () => {
    if (!mockState.ownerOk) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    return {
      ok: true,
      userId: "owner-1",
      companyId: "company-1",
      companyName: "RxTrace Co",
      userEmail: "owner@rxtrace.in",
      supabase: {},
    };
  },
}));

vi.mock("@/lib/billing/finalizeQuoteInternal", () => ({
  finalizeQuoteInternal: async () => {
    if (mockState.finalizeError) {
      throw mockState.finalizeError;
    }
    return mockState.finalizeResult;
  },
}));

describe("POST /api/user/subscription/checkout/finalize", () => {
  beforeEach(() => {
    mockState.ownerOk = true;
    mockState.finalizeResult = {
      quote_id: "quote-1",
      invoice_reference: "quote:quote-1",
      no_op: false,
    };
    mockState.finalizeError = null;
  });

  it("returns successful finalization payload", async () => {
    const { POST } = await import("@/app/api/user/subscription/checkout/finalize/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.quote_id).toBe("quote-1");
    expect(json.invoice_reference).toBe("quote:quote-1");
    expect(json.no_op).toBe(false);
  });

  it("maps already-paid-but-not-captured errors to 409", async () => {
    mockState.finalizeError = new Error("PAYMENT_NOT_CAPTURED_YET");

    const { POST } = await import("@/app/api/user/subscription/checkout/finalize/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("PAYMENT_NOT_CAPTURED_YET");
  });

  it("returns no-op finalization replay successfully", async () => {
    mockState.finalizeResult = {
      quote_id: "quote-1",
      invoice_reference: "quote:quote-1",
      no_op: true,
    };

    const { POST } = await import("@/app/api/user/subscription/checkout/finalize/route");
    const req = new Request("http://localhost/api/user/subscription/checkout/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: "quote-1" }),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.no_op).toBe(true);
  });
});

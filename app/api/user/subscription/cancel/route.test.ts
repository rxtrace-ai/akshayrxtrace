import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  ownerOk: true,
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

describe("POST /api/user/subscription/cancel", () => {
  beforeEach(() => {
    mockState.ownerOk = true;
  });

  it("rejects missing Idempotency-Key headers", async () => {
    const { POST } = await import("@/app/api/user/subscription/cancel/route");
    const req = new Request("http://localhost/api/user/subscription/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req as any);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatchObject({
      message: "Missing Idempotency-Key header",
    });
  });
});

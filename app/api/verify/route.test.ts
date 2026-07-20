import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  rateLimitResponses: [] as any[],
}));

vi.mock("@/lib/security/rateLimit", () => ({
  consumeRateLimit: vi.fn(async () => mockState.rateLimitResponses.shift() ?? { allowed: true, remaining: 10 }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("@/lib/company/resolve", () => ({
  resolveCompanyIdFromRequest: async () => null,
}));

vi.mock("@/lib/scanner/idempotency", () => ({
  beginScannerIdempotency: async () => ({
    kind: "replay",
    statusCode: 200,
    payload: { success: true, data: { status: "VALID" } },
    key: "idem-1",
    requestHash: "hash-1",
  }),
  completeScannerIdempotency: async () => undefined,
  waitForScannerReplay: async () => ({ kind: "pending" }),
}));

vi.mock("@/lib/scanner/logging", () => ({
  insertScanLogSafe: async () => undefined,
  recordSerialScanAtomic: async () => null,
}));

vi.mock("@/lib/observability/logging", () => ({
  logError: () => undefined,
}));

describe("POST /api/verify rate limiting", () => {
  beforeEach(() => {
    mockState.rateLimitResponses = [];
  });

  it("allows requests below the limit", async () => {
    mockState.rateLimitResponses = [
      { allowed: true, remaining: 10 },
      { allowed: true, remaining: 10 },
    ];

    const { POST } = await import("@/app/api/verify/route");
    const req = new Request("http://localhost/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-verify-1",
      },
      body: JSON.stringify({ raw: "not-a-real-code" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("returns 429 above the limit without leaking the scanned payload", async () => {
    mockState.rateLimitResponses = [{ allowed: false, retryAfterSeconds: 17 }];

    const { POST } = await import("@/app/api/verify/route");
    const req = new Request("http://localhost/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-verify-2",
      },
      body: JSON.stringify({ raw: "RAW_SECRET_CODE_123" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(JSON.stringify(json)).not.toContain("RAW_SECRET_CODE_123");
  });
});

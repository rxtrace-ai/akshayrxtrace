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
  resolveCompanyIdFromRequest: async () => "company-1",
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

describe("POST /api/scan rate limiting", () => {
  beforeEach(() => {
    mockState.rateLimitResponses = [];
  });

  it("allows valid scanner traffic below the limit", async () => {
    mockState.rateLimitResponses = [
      { allowed: true, remaining: 10 },
      { allowed: true, remaining: 10 },
    ];

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-scan-1",
      },
      body: JSON.stringify({ raw: "scanner-sample", device_context: { device_id: "device-1" } }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("returns 429 above the limit without leaking the device auth token", async () => {
    mockState.rateLimitResponses = [{ allowed: false, retryAfterSeconds: 11 }];

    const { POST } = await import("@/app/api/scan/route");
    const req = new Request("http://localhost/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-scan-2",
      },
      body: JSON.stringify({
        raw: "scanner-sample",
        device_context: { device_id: "device-1", auth_token: "secret-device-token" },
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(res.headers.get("Retry-After")).toBe("11");
    expect(JSON.stringify(json)).not.toContain("secret-device-token");
  });
});

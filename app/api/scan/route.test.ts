import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  rateLimitResponses: [] as any[],
  logCalls: [] as any[],
}));

vi.mock("@/lib/security/rateLimit", () => ({
  consumeRateLimit: vi.fn(async () => mockState.rateLimitResponses.shift() ?? { allowed: true, remaining: 10 }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("@/lib/handset-v2/scannerContext", () => ({
  resolveScannerRequestContext: async () => ({ companyId: "company-1", handsetId: "handset-1" }),
}));

vi.mock("@/lib/scanner/idempotency", () => ({
  buildRequestHash: () => "hash-replay",
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
  insertScanLogSafe: async (_supabase: unknown, payload: any) => { mockState.logCalls.push(payload); return { ok: true }; },
  recordSerialScanAtomic: async () => null,
}));

vi.mock("@/lib/observability/logging", () => ({
  logError: () => undefined,
}));

describe("POST /api/scan rate limiting", () => {
  beforeEach(() => {
    mockState.rateLimitResponses = [];
    mockState.logCalls = [];
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
    expect(mockState.logCalls[0]).toMatchObject({ company_id: "company-1", handset_id: "handset-1", endpoint: "scan" });
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

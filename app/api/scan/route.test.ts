import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  rateLimitResponses: [] as any[],
  logCalls: [] as any[],
  beginKind: "replay" as "replay" | "ok",
  unitFound: true,
  logOk: true,
  completeCalls: [] as any[],
}));

vi.mock("@/lib/security/rateLimit", () => ({
  consumeRateLimit: vi.fn(async () => mockState.rateLimitResponses.shift() ?? { allowed: true, remaining: 10 }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => {
    const row = { id: "unit-uuid-1", company_id: "company-1", box_id: null, serial: "SERIAL-1", gs1_payload: null, payload: null, code_mode: "PIC", created_at: "2026-01-01" };
    const query: any = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: mockState.unitFound ? row : null, error: null }),
    };
    return { from: () => query };
  },
}));

vi.mock("@/lib/handset-v2/scannerContext", () => ({
  resolveScannerRequestContext: async () => ({ companyId: "company-1", handsetId: "handset-1" }),
}));

vi.mock("@/lib/scanner/idempotency", () => ({
  buildRequestHash: () => "hash-replay",
  beginScannerIdempotency: async () => mockState.beginKind === "replay"
    ? { kind: "replay", statusCode: 200, payload: { success: true, data: { status: "VALID", level: "unit", result: { id: "unit-uuid-1" } } }, key: "idem-1", requestHash: "hash-1" }
    : { kind: "ok", key: "idem-1", requestHash: "hash-1" },
  completeScannerIdempotency: async (args: any) => { mockState.completeCalls.push(args); },
  waitForScannerReplay: async () => ({ kind: "pending" }),
}));

vi.mock("@/lib/scanner/logging", () => ({
  insertScanLogSafe: async (_supabase: unknown, payload: any) => { mockState.logCalls.push(payload); return mockState.logOk ? { ok: true } : { ok: false, errorCode: "XX000", message: "Database rejected scan log write" }; },
  recordSerialScanAtomic: async () => null,
}));

vi.mock("@/lib/observability/logging", () => ({
  logError: () => undefined,
}));

describe("POST /api/scan rate limiting", () => {
  beforeEach(() => {
    mockState.rateLimitResponses = [];
    mockState.logCalls = [];
    mockState.beginKind = "replay";
    mockState.unitFound = true;
    mockState.logOk = true;
    mockState.completeCalls = [];
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

  it("logs a matched unit with company attribution and its UUID in metadata, never code_id", async () => {
    mockState.beginKind = "ok";
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-unit" },
      body: JSON.stringify({ raw: "(95)SERIAL-1" }),
    }));
    expect(res.status).toBe(200);
    expect(mockState.logCalls[0]).toMatchObject({ company_id: "company-1", code_id: null, metadata: { entity_type: "unit_label", entity_id: "unit-uuid-1" } });
  });

  it("logs unmatched scans without inventing an entity reference", async () => {
    mockState.beginKind = "ok";
    mockState.unitFound = false;
    const { POST } = await import("@/app/api/scan/route");
    const res = await POST(new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-missing" },
      body: JSON.stringify({ raw: "(95)SERIAL-1" }),
    }));
    expect(res.status).toBe(404);
    expect(mockState.logCalls[0]).toMatchObject({ company_id: "company-1", code_id: null, metadata: { reason: "code_not_found" } });
  });

  it("returns retryable failure for a failed log write and reconciles on duplicate request", async () => {
    mockState.beginKind = "ok";
    mockState.logOk = false;
    const { POST } = await import("@/app/api/scan/route");
    const request = () => new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-retry" },
      body: JSON.stringify({ raw: "(95)SERIAL-1" }),
    });
    const first = await POST(request());
    expect(first.status).toBe(503);
    expect(mockState.completeCalls).toHaveLength(1);

    mockState.beginKind = "replay";
    mockState.logOk = true;
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect(mockState.logCalls).toHaveLength(2);
    expect(mockState.logCalls[1].metadata).toMatchObject({ entity_type: "unit_label", entity_id: "unit-uuid-1" });
  });
});

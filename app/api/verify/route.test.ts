import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  beginKind: "ok" as "ok" | "replay",
  rateLimitAllowed: true,
  logResult: { ok: true } as { ok: boolean; errorCode?: string; message?: string },
  logCalls: [] as any[],
  completeCalls: [] as any[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ id: "unit-1", company_id: "company-1", serial: "SERIAL-1", gtin: null, batch: null, payload: null, gs1_payload: null, code_mode: "PIC", created_at: "2026-01-01" }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/company/resolve", () => ({ resolveCompanyIdFromRequest: async () => null }));
vi.mock("@/lib/scanner/requestRateLimit", () => ({
  enforceVerifyRateLimit: async () => state.rateLimitAllowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: 17 },
}));
vi.mock("@/lib/scanner/idempotency", () => ({
  beginScannerIdempotency: async () => state.beginKind === "replay"
    ? { kind: "replay", statusCode: 200, payload: { success: true, status: "DUPLICATE" }, key: "idem-verify-1", requestHash: "hash-1" }
    : { kind: "ok", key: "idem-verify-1", requestHash: "hash-1" },
  completeScannerIdempotency: async (args: any) => { state.completeCalls.push(args); },
  waitForScannerReplay: async () => ({ kind: "pending" }),
}));
vi.mock("@/lib/scanner/logging", () => ({
  insertScanLogSafe: async (_supabase: unknown, payload: any) => { state.logCalls.push(payload); return state.logResult; },
  recordSerialScanAtomic: async () => ({ isDuplicate: true, firstScannedAt: "2026-01-01T00:00:00.000Z", scanCount: 2 }),
}));
vi.mock("@/lib/observability/logging", () => ({ logError: () => undefined, logWarn: () => undefined }));

function request() {
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-verify-1" },
    body: JSON.stringify({ raw: "(95)SERIAL-1" }),
  });
}

describe("POST /api/verify scan-log behavior", () => {
  beforeEach(() => {
    state.beginKind = "ok";
    state.rateLimitAllowed = true;
    state.logResult = { ok: true };
    state.logCalls = [];
    state.completeCalls = [];
  });

  it("attempts a log write for duplicate verification and returns DUPLICATE", async () => {
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("DUPLICATE");
    expect(state.logCalls).toHaveLength(1);
    expect(state.logCalls[0]).toMatchObject({ company_id: "company-1", status: "FAILED", endpoint: "verify", idempotency_key: "idem-verify-1" });
  });

  it("keeps a valid duplicate result when the log write fails", async () => {
    state.logResult = { ok: false, errorCode: "08006", message: "Database rejected scan log write" };
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("DUPLICATE");
    expect(state.completeCalls).toHaveLength(1);
  });

  it("retries the same upsert on completed replay after a failed write", async () => {
    state.logResult = { ok: false, errorCode: "08006", message: "Database rejected scan log write" };
    const { POST } = await import("@/app/api/verify/route");
    await POST(request());

    state.beginKind = "replay";
    state.logResult = { ok: true };
    const replay = await POST(request());
    const payload = await replay.json();

    expect(payload.status).toBe("DUPLICATE");
    expect(state.logCalls).toHaveLength(2);
    expect(state.logCalls[0].idempotency_key).toBe(state.logCalls[1].idempotency_key);
    expect(state.logCalls[0].company_id).toBe(state.logCalls[1].company_id);
  });

  it("preserves rate limiting and does not log rejected requests", async () => {
    state.rateLimitAllowed = false;
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(state.logCalls).toHaveLength(0);
  });
});

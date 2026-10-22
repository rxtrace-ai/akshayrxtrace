import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  beginKind: "ok" as "ok" | "replay",
  handsetId: "handset-1" as string | null,
  companyId: null as string | null,
  isDuplicate: true,
  unitFound: true,
  unitExpiry: "",
  rateLimitAllowed: true,
  logResult: { ok: true } as { ok: boolean; errorCode?: string; message?: string },
  logCalls: [] as any[],
  completeCalls: [] as any[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => {
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: any) => resolve({
        data: state.unitFound ? [{ id: "unit-1", company_id: "company-1", serial: "SERIAL-1", gtin: null, batch: null, payload: null, gs1_payload: null, code_mode: "PIC", created_at: "2026-01-01", expiry: state.unitExpiry }] : [],
        error: null,
      }),
    };
    return { from: () => query };
  },
}));

vi.mock("@/lib/handset-v2/scannerContext", () => ({
  resolveScannerRequestContext: async () => ({ companyId: state.companyId, handsetId: state.handsetId }),
}));
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
  recordSerialScanAtomic: async () => ({ isDuplicate: state.isDuplicate, firstScannedAt: "2026-01-01T00:00:00.000Z", scanCount: state.isDuplicate ? 2 : 1 }),
}));
vi.mock("@/lib/observability/logging", () => ({ logError: () => undefined, logWarn: () => undefined }));

function request(body: any = { raw: "(95)SERIAL-1" }) {
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-verify-1" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/verify scan-log behavior", () => {
  beforeEach(() => {
    state.beginKind = "ok";
    state.handsetId = "handset-1";
    state.companyId = null;
    state.isDuplicate = true;
    state.unitFound = true;
    state.unitExpiry = "";
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
    expect(state.logCalls[0]).toMatchObject({ company_id: "company-1", handset_id: "handset-1", status: "DUPLICATE", endpoint: "verify", idempotency_key: "idem-verify-1" });
    expect(state.logCalls[0]).toMatchObject({ code_id: null, metadata: { entity_type: "unit_label", entity_id: "unit-1" } });
  });

  it("returns retryable failure while caching the outcome for log reconciliation", async () => {
    state.logResult = { ok: false, errorCode: "08006", message: "Database rejected scan log write" };
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("SCAN_LOG_UNAVAILABLE");
    expect(state.completeCalls).toHaveLength(1);
  });

  it("records a first valid scan with the authenticated handset and actual outcome", async () => {
    state.isDuplicate = false;
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());
    const payload = await response.json();

    expect(payload.status).toBe("VALID");
    expect(state.logCalls[0]).toMatchObject({
      company_id: "company-1",
      handset_id: "handset-1",
      status: "VALID",
      endpoint: "verify",
      parsed: { serial: "SERIAL-1", mode: "PIC" },
    });
  });

  it("retries a failed log write on the next idempotent request", async () => {
    state.logResult = { ok: false, errorCode: "08006", message: "Database rejected scan log write" };
    const { POST } = await import("@/app/api/verify/route");
    const first = await POST(request());
    expect(first.status).toBe(503);

    state.beginKind = "replay";
    state.logResult = { ok: true };
    const replay = await POST(request());
    const payload = await replay.json();

    expect(payload.status).toBe("DUPLICATE");
    expect(state.logCalls).toHaveLength(2);
    expect(state.logCalls[0].idempotency_key).toBe(state.logCalls[1].idempotency_key);
    expect(state.logCalls[0].company_id).toBe(state.logCalls[1].company_id);
    expect(state.completeCalls).toHaveLength(1);
  });

  it("logs unmatched verify requests with a null entity reference", async () => {
    state.unitFound = false;
    state.companyId = "company-1";
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(state.logCalls[0]).toMatchObject({ company_id: "company-1", code_id: null, metadata: { reason: "code_not_found" } });
  });

  it("keeps unit-label reference on invalid expiry logs", async () => {
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request({ raw: "(93)991332(95)SERIAL-1" }));
    expect(response.status).toBe(200);
    expect(state.logCalls[0]).toMatchObject({ code_id: null, metadata: { reason: "invalid_expiry", entity_type: "unit_label", entity_id: "unit-1" } });
  });

  it("leaves handset association optional when verified handset context is unavailable", async () => {
    state.handsetId = null;
    const { POST } = await import("@/app/api/verify/route");
    await POST(request());

    expect(state.logCalls[0].handset_id).toBeNull();
  });

  it("rejects a scan request that claims a company different from the authenticated handset", async () => {
    state.companyId = "company-1";
    const { POST } = await import("@/app/api/verify/route");
    const response = await POST(request({ raw: "(95)SERIAL-1", company_id: "00000000-0000-4000-8000-000000000002" }));

    expect(response.status).toBe(403);
    expect(state.logCalls).toHaveLength(0);
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

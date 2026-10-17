import { describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/observability/logging", () => ({ logError }));

import { insertScanLogSafe } from "@/lib/scanner/logging";

function createSupabase(error: any = null) {
  const upsert = vi.fn(async () => ({ error }));
  const insert = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ upsert, insert }));
  return { client: { from } as any, from, upsert, insert };
}

const payload = {
  company_id: "company-safe-id",
  raw_scan: "PRODUCT_SECRET_123",
  parsed: { serial: "PRODUCT_SECRET_123" },
  status: "FAILED",
  endpoint: "verify" as const,
  idempotency_key: "idem-safe-123",
  request_hash: "hash-123",
};

describe("insertScanLogSafe", () => {
  it("upserts successfully with the unique-index conflict target", async () => {
    const db = createSupabase();
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: true });
    expect(db.from).toHaveBeenCalledWith("scan_logs");
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({ company_id: payload.company_id }), {
      onConflict: "company_id,endpoint,idempotency_key",
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("returns an observable safe failure and logs no scan payload or raw DB message", async () => {
    const db = createSupabase({ code: "23505", message: "duplicate value PRODUCT_SECRET_123" });
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: false, errorCode: "23505", message: "Database rejected scan log write" });
    expect(logError).toHaveBeenCalledWith("Scanner log write failed", expect.objectContaining({
      operation: "scanner_log_insert",
      endpoint: "verify",
      errorCode: "23505",
      errorMessage: "Database rejected scan log write",
    }));
    expect(JSON.stringify(logError.mock.calls)).not.toContain("PRODUCT_SECRET_123");
  });
});

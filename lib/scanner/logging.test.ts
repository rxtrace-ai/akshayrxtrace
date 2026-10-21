import { describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/observability/logging", () => ({ logError }));

import { insertScanLogSafe } from "@/lib/scanner/logging";

function createSupabase(insertError: any = null, updateError: any = null, updatedRow: any = { id: "log-1" }) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const maybeSingle = vi.fn(async () => ({ data: updatedRow, error: updateError }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eqKey = vi.fn(() => ({ select }));
  const eqEndpoint = vi.fn(() => ({ eq: eqKey }));
  const eqCompany = vi.fn(() => ({ eq: eqEndpoint }));
  const update = vi.fn(() => ({ eq: eqCompany }));
  const from = vi.fn(() => ({ insert, update }));
  return { client: { from } as any, from, insert, update, eqCompany, eqEndpoint, eqKey, select, maybeSingle };
}

const payload = {
  company_id: "company-safe-id",
  raw_scan: "PRODUCT_SECRET_123",
  parsed: { serial: "PRODUCT_SECRET_123" },
  metadata: { status: "DUPLICATE", serial: "SERIAL-1", quota_consumed: false },
  status: "FAILED",
  endpoint: "verify" as const,
  idempotency_key: "idem-safe-123",
  request_hash: "hash-123",
};

describe("insertScanLogSafe", () => {
  it("inserts a new idempotent log row", async () => {
    const db = createSupabase();
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: true });
    expect(db.from).toHaveBeenCalledWith("scan_logs");
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: payload.company_id,
      endpoint: "verify",
      status: "FAILED",
      metadata: payload.metadata,
      idempotency_key: payload.idempotency_key,
      request_hash: payload.request_hash,
      scanned_at: expect.any(String),
    }));
    expect(logError).not.toHaveBeenCalled();
  });

  it("updates the same row when a replay hits the existing unique key", async () => {
    const db = createSupabase({ code: "23505", message: "duplicate value" });
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: true });
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      company_id: payload.company_id,
      endpoint: "verify",
      idempotency_key: payload.idempotency_key,
    }));
    expect(db.eqCompany).toHaveBeenCalledWith("company_id", payload.company_id);
    expect(db.eqEndpoint).toHaveBeenCalledWith("endpoint", "verify");
    expect(db.eqKey).toHaveBeenCalledWith("idempotency_key", payload.idempotency_key);
    expect(logError).not.toHaveBeenCalled();
  });

  it("reports a unique collision if no matching row can be reconciled", async () => {
    const db = createSupabase({ code: "23505" }, null, null);
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toMatchObject({ ok: false, errorCode: "23505" });
    expect(logError).toHaveBeenCalled();
  });

  it("returns an observable safe failure and logs no scan payload or raw DB message", async () => {
    const db = createSupabase({ code: "XX000", message: "database failure PRODUCT_SECRET_123" });
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: false, errorCode: "XX000", message: "Database rejected scan log write" });
    expect(logError).toHaveBeenCalledWith("Scanner log write failed", expect.objectContaining({
      operation: "scanner_log_insert",
      endpoint: "verify",
      errorCode: "XX000",
      errorMessage: "Database rejected scan log write",
    }));
    expect(JSON.stringify(logError.mock.calls)).not.toContain("PRODUCT_SECRET_123");
  });
});

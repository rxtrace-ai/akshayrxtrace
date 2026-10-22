import { beforeEach, describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/observability/logging", () => ({ logError }));

import { insertScanLogSafe } from "@/lib/scanner/logging";

function createSupabase(insertError: any = null, updateError: any = null, updatedRow: any = { id: "log-1" }, printer: any = null, code: any = null) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const maybeSingle = vi.fn(async () => ({ data: updatedRow, error: updateError }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eqKey = vi.fn(() => ({ select }));
  const eqEndpoint = vi.fn(() => ({ eq: eqKey }));
  const eqCompany = vi.fn(() => ({ eq: eqEndpoint }));
  const update = vi.fn((_row: any) => ({ eq: eqCompany }));
  const printerMaybeSingle = vi.fn(async () => ({ data: printer, error: null }));
  const printerEq = vi.fn(() => ({ maybeSingle: printerMaybeSingle }));
  const printerSelect = vi.fn(() => ({ eq: printerEq }));
  const codeMaybeSingle = vi.fn(async () => ({ data: code, error: null }));
  const codeEq = vi.fn(() => ({ maybeSingle: codeMaybeSingle }));
  const codeSelect = vi.fn(() => ({ eq: codeEq }));
  const from = vi.fn((table: string) => table === "printers"
    ? { select: printerSelect }
    : table === "codes"
      ? { select: codeSelect }
      : { insert, update });
  return { client: { from } as any, from, insert, update, eqCompany, eqEndpoint, eqKey, select, maybeSingle, printerEq, codeEq };
}

const payload = {
  company_id: "company-safe-id",
  raw_scan: "PRODUCT_SECRET_123",
  parsed: { serial: "PRODUCT_SECRET_123" },
  metadata: { status: "DUPLICATE", serial: "SERIAL-1", quota_consumed: false },
  handset_id: "handset-safe-id",
  status: "DUPLICATE",
  endpoint: "verify" as const,
  idempotency_key: "idem-safe-123",
  request_hash: "hash-123",
};

describe("insertScanLogSafe", () => {
  beforeEach(() => logError.mockClear());

  it("inserts a new idempotent log row", async () => {
    const db = createSupabase();
    const result = await insertScanLogSafe(db.client, payload);

    expect(result).toEqual({ ok: true });
    expect(db.from).toHaveBeenCalledWith("scan_logs");
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: payload.company_id,
      endpoint: "verify",
      status: "DUPLICATE",
      metadata: payload.metadata,
      handset_id: payload.handset_id,
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
    expect("metadata" in db.update.mock.calls[0][0]).toBe(false);
    expect(db.eqCompany).toHaveBeenCalledWith("company_id", payload.company_id);
    expect(db.eqEndpoint).toHaveBeenCalledWith("endpoint", "verify");
    expect(db.eqKey).toHaveBeenCalledWith("idempotency_key", payload.idempotency_key);
    expect(logError).not.toHaveBeenCalled();
  });

  it("does not clear an existing handset ID when a retry lacks handset context", async () => {
    const db = createSupabase({ code: "23505", message: "duplicate value" });
    await insertScanLogSafe(db.client, { ...payload, handset_id: null });

    const updateRow = db.update.mock.calls[0][0];
    expect("handset_id" in updateRow).toBe(false);
    expect("scanned_at" in updateRow).toBe(false);
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

  it("stores a printer ID only when it resolves to an existing printer row", async () => {
    const valid = createSupabase(null, null, { id: "log-1" }, { id: 23 });
    await insertScanLogSafe(valid.client, { ...payload, scanner_printer_id: "23" });
    expect(valid.printerEq).toHaveBeenCalledWith("id", "23");
    expect(valid.insert).toHaveBeenCalledWith(expect.objectContaining({ scanner_printer_id: "23" }));

    const missing = createSupabase();
    await insertScanLogSafe(missing.client, { ...payload, scanner_printer_id: "999" });
    expect(missing.from).toHaveBeenCalledWith("scan_logs");
    expect(missing.printerEq).toHaveBeenCalledWith("id", "999");
    expect(missing.insert).toHaveBeenCalledWith(expect.objectContaining({ scanner_printer_id: null }));
  });

  it("stores code_id only when it resolves to a real codes row", async () => {
    const valid = createSupabase(null, null, { id: "log-1" }, null, { id: 81 });
    await insertScanLogSafe(valid.client, { ...payload, code_id: 81 });
    expect(valid.codeEq).toHaveBeenCalledWith("id", "81");
    expect(valid.insert).toHaveBeenCalledWith(expect.objectContaining({ code_id: "81" }));

    const missing = createSupabase();
    await insertScanLogSafe(missing.client, { ...payload, code_id: 82 });
    expect(missing.insert).toHaveBeenCalledWith(expect.objectContaining({ code_id: null }));
  });
});

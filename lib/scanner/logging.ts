import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/observability/logging";

type ScanLogPayload = {
  company_id: string | null;
  raw_scan: string;
  parsed: any;
  code_id?: string | null;
  scanner_printer_id?: string | null;
  scanned_at?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
  status: string;
  endpoint: "scan" | "verify";
  idempotency_key?: string | null;
  request_hash?: string | null;
};

export type ScanLogWriteResult =
  | { ok: true }
  | { ok: false; errorCode: string; message: string };

function isUniqueViolation(error: any): boolean {
  return String(error?.code || "") === "23505";
}

export async function insertScanLogSafe(supabase: SupabaseClient, payload: ScanLogPayload): Promise<ScanLogWriteResult> {
  const row = {
    company_id: payload.company_id,
    handset_id: null,
    raw_scan: payload.raw_scan,
    parsed: payload.parsed ?? null,
    code_id: payload.code_id ?? null,
    scanner_printer_id: payload.scanner_printer_id ?? null,
    scanned_at: payload.scanned_at ?? new Date().toISOString(),
    ip: payload.ip ?? null,
    metadata: payload.metadata ?? {},
    status: payload.status,
    endpoint: payload.endpoint,
    idempotency_key: payload.idempotency_key ?? null,
    request_hash: payload.request_hash ?? null,
  };

  try {
    if (row.idempotency_key && row.company_id) {
      // The existing unique index is partial (idempotency_key IS NOT NULL), so
      // Postgres cannot infer it from a bare ON CONFLICT column list. Insert first
      // and reconcile only the matching idempotency key on a unique-key replay.
      const { error: insertError } = await supabase.from("scan_logs").insert(row as any);
      if (insertError) {
        if (!isUniqueViolation(insertError)) throw insertError;

        const { data, error: updateError } = await supabase
          .from("scan_logs")
          .update(row as any)
          .eq("company_id", row.company_id)
          .eq("endpoint", row.endpoint)
          .eq("idempotency_key", row.idempotency_key)
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!data) throw insertError;
      }
      return { ok: true };
    }
    const { error } = await supabase.from("scan_logs").insert(row as any);
    if (error) throw error;
    return { ok: true };
  } catch (error: any) {
    const candidateCode = String(error?.code || "UNKNOWN");
    const errorCode = /^[A-Z0-9_]{1,32}$/.test(candidateCode) ? candidateCode : "UNKNOWN";
    // Use a fixed message: database error messages can contain key values or row data.
    const message = "Database rejected scan log write";
    logError("Scanner log write failed", {
      operation: "scanner_log_insert",
      endpoint: payload.endpoint,
      errorCode,
      errorMessage: message,
    });
    return { ok: false, errorCode, message };
  }
}

export async function recordSerialScanAtomic(params: {
  supabase: SupabaseClient;
  companyId: string;
  serial: string;
}): Promise<{ isDuplicate: boolean; firstScannedAt: string | null; scanCount: number }> {
  const serial = String(params.serial || "").trim();
  if (!serial) {
    return { isDuplicate: false, firstScannedAt: null, scanCount: 0 };
  }

  const { data, error } = await params.supabase.rpc("record_scanner_serial_scan", {
    p_company_id: params.companyId,
    p_serial: serial,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    isDuplicate: Boolean((row as any)?.is_duplicate),
    firstScannedAt: ((row as any)?.first_scanned_at as string) ?? null,
    scanCount: Number((row as any)?.scan_count ?? 0),
  };
}

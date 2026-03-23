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

export async function insertScanLogSafe(supabase: SupabaseClient, payload: ScanLogPayload): Promise<void> {
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
      const { error } = await supabase
        .from("scan_logs")
        .upsert(row as any, { onConflict: "company_id,endpoint,idempotency_key" });
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from("scan_logs").insert(row as any);
    if (error) throw error;
  } catch (error: any) {
    logError("Scanner log write failed", {
      operation: "scanner_log_insert",
      endpoint: payload.endpoint,
      companyId: payload.company_id ?? undefined,
      error: String(error?.message || error),
    });
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


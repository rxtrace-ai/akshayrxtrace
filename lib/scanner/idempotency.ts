import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type StoredRow = {
  request_hash: string;
  state: "PENDING" | "COMPLETED";
  status_code: number | null;
  response_snapshot_json: any;
};

export type ScannerIdempotencyBegin =
  | { kind: "missing_key" }
  | { kind: "conflict" }
  | { kind: "replay"; statusCode: number; payload: any }
  | { kind: "pending"; key: string; requestHash: string }
  | { kind: "ok"; key: string; requestHash: string };

function normalizeIdempotencyKey(value: unknown): string {
  return String(value ?? "").trim();
}

function extractHeaderKey(req: Request): string {
  return normalizeIdempotencyKey(
    req.headers.get("idempotency-key") ||
      req.headers.get("Idempotency-Key") ||
      req.headers.get("x-idempotency-key")
  );
}

function isUniqueViolation(error: any): boolean {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "23505" || message.includes("duplicate key");
}

async function readRow(params: {
  supabase: SupabaseClient;
  endpoint: string;
  scopeKey: string;
  idempotencyKey: string;
}): Promise<StoredRow | null> {
  const { data, error } = await params.supabase
    .from("scanner_request_idempotency")
    .select("request_hash, state, status_code, response_snapshot_json")
    .eq("endpoint", params.endpoint)
    .eq("scope_key", params.scopeKey)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return (data as StoredRow | null) ?? null;
}

export function buildRequestHash(payload: unknown): string {
  const body = JSON.stringify(payload ?? {});
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function readScannerIdempotencyKey(req: Request, body: any): string {
  const bodyKey = normalizeIdempotencyKey(body?.idempotency_key);
  if (bodyKey) return bodyKey;
  return extractHeaderKey(req);
}

export async function beginScannerIdempotency(params: {
  supabase: SupabaseClient;
  endpoint: string;
  scopeKey: string;
  req: Request;
  body: any;
  requestHashPayload: unknown;
}): Promise<ScannerIdempotencyBegin> {
  const key = readScannerIdempotencyKey(params.req, params.body);
  if (!key) return { kind: "missing_key" };

  const requestHash = buildRequestHash(params.requestHashPayload);
  const existing = await readRow({
    supabase: params.supabase,
    endpoint: params.endpoint,
    scopeKey: params.scopeKey,
    idempotencyKey: key,
  });
  if (existing) {
    if (String(existing.request_hash || "") !== requestHash) return { kind: "conflict" };
    if (existing.state === "COMPLETED") {
      return {
        kind: "replay",
        statusCode: Number(existing.status_code ?? 200),
        payload: existing.response_snapshot_json ?? {},
      };
    }
    return { kind: "pending", key, requestHash };
  }

  const { error } = await params.supabase.from("scanner_request_idempotency").insert({
    endpoint: params.endpoint,
    scope_key: params.scopeKey,
    idempotency_key: key,
    request_hash: requestHash,
    state: "PENDING",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (!error) return { kind: "ok", key, requestHash };
  if (!isUniqueViolation(error)) throw error;

  const raceRow = await readRow({
    supabase: params.supabase,
    endpoint: params.endpoint,
    scopeKey: params.scopeKey,
    idempotencyKey: key,
  });
  if (!raceRow) return { kind: "pending", key, requestHash };
  if (String(raceRow.request_hash || "") !== requestHash) return { kind: "conflict" };
  if (raceRow.state === "COMPLETED") {
    return {
      kind: "replay",
      statusCode: Number(raceRow.status_code ?? 200),
      payload: raceRow.response_snapshot_json ?? {},
    };
  }
  return { kind: "pending", key, requestHash };
}

export async function waitForScannerReplay(params: {
  supabase: SupabaseClient;
  endpoint: string;
  scopeKey: string;
  idempotencyKey: string;
  requestHash: string;
  timeoutMs?: number;
}): Promise<{ kind: "replay"; statusCode: number; payload: any } | { kind: "pending" | "conflict" }> {
  const timeoutMs = Math.max(200, Number(params.timeoutMs ?? 3000));
  const intervalMs = 150;
  const endAt = Date.now() + timeoutMs;

  while (Date.now() < endAt) {
    const row = await readRow({
      supabase: params.supabase,
      endpoint: params.endpoint,
      scopeKey: params.scopeKey,
      idempotencyKey: params.idempotencyKey,
    });
    if (!row) return { kind: "pending" };
    if (String(row.request_hash || "") !== params.requestHash) return { kind: "conflict" };
    if (row.state === "COMPLETED") {
      return {
        kind: "replay",
        statusCode: Number(row.status_code ?? 200),
        payload: row.response_snapshot_json ?? {},
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { kind: "pending" };
}

export async function completeScannerIdempotency(params: {
  supabase: SupabaseClient;
  endpoint: string;
  scopeKey: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  payload: any;
}) {
  const { error } = await params.supabase
    .from("scanner_request_idempotency")
    .update({
      state: "COMPLETED",
      status_code: params.statusCode,
      response_snapshot_json: params.payload ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("endpoint", params.endpoint)
    .eq("scope_key", params.scopeKey)
    .eq("idempotency_key", params.idempotencyKey)
    .eq("request_hash", params.requestHash);
  if (error) throw error;
}

import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/admin/responses";

export type IdempotencyReplay =
  | { kind: "new"; key: string; requestHash: string; endpoint: string }
  | { kind: "replay"; statusCode: number; payload: Record<string, unknown> }
  | { kind: "conflict" }
  | { kind: "missing_key" };

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function buildRequestHash(method: string, endpoint: string, body: unknown): string {
  const normalized = stableSerialize(body ?? {});
  return sha256(`${method.toUpperCase()}|${endpoint}|${normalized}`);
}

export async function checkAdminIdempotency(params: {
  adminId: string;
  endpoint: string;
  method: string;
  idempotencyKey: string | null;
  body: unknown;
}): Promise<IdempotencyReplay> {
  if (!params.idempotencyKey) return { kind: "missing_key" };

  const supabase = getSupabaseAdmin();
  const requestHash = buildRequestHash(params.method, params.endpoint, params.body);

  const { data: existing, error } = await supabase
    .from("admin_idempotency_keys")
    .select("request_hash, response_snapshot_json, status_code")
    .eq("admin_id", params.adminId)
    .eq("endpoint", params.endpoint)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!existing) {
    return {
      kind: "new",
      key: params.idempotencyKey,
      requestHash,
      endpoint: params.endpoint,
    };
  }

  if (existing.request_hash !== requestHash) {
    return { kind: "conflict" };
  }

  return {
    kind: "replay",
    statusCode: Number(existing.status_code || 200),
    payload: (existing.response_snapshot_json || {}) as Record<string, unknown>,
  };
}

export async function persistAdminIdempotencyResult(params: {
  adminId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  payload: Record<string, unknown>;
  correlationId: string;
  supabase?: ReturnType<typeof getSupabaseAdmin>;
}) {
  const supabase = params.supabase ?? getSupabaseAdmin();
  const { error } = await supabase.from("admin_idempotency_keys").insert({
    admin_id: params.adminId,
    endpoint: params.endpoint,
    idempotency_key: params.idempotencyKey,
    request_hash: params.requestHash,
    response_snapshot_json: params.payload,
    status_code: params.statusCode,
    correlation_id: params.correlationId,
    created_at: new Date().toISOString(),
  });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}

export function idempotencyErrorResponse(kind: "missing_key" | "conflict", correlationId: string) {
  if (kind === "missing_key") {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "Missing Idempotency-Key header",
      correlationId
    );
  }
  return errorResponse(
    409,
    "IDEMPOTENCY_CONFLICT",
    "Idempotency key conflict (same key with different request payload)",
    correlationId
  );
}

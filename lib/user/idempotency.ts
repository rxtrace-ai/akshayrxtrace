import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UserIdempotencyCheck =
  | { kind: "missing_key" }
  | { kind: "conflict" }
  | { kind: "replay"; statusCode: number; payload: any }
  | { kind: "ok"; key: string; requestHash: string };

export function hashRequestBody(body: unknown): string {
  const payload = JSON.stringify(body ?? {});
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function checkUserIdempotency(params: {
  supabase: SupabaseClient;
  userId: string;
  endpoint: string;
  idempotencyKey: string | null;
  requestHash: string;
}): Promise<UserIdempotencyCheck> {
  const key = String(params.idempotencyKey || "").trim();
  if (!key) return { kind: "missing_key" };

  const { data, error } = await params.supabase
    .from("user_idempotency_keys")
    .select("request_hash, response_snapshot_json, status_code")
    .eq("user_id", params.userId)
    .eq("endpoint", params.endpoint)
    .eq("idempotency_key", key)
    .maybeSingle();

  if (error) throw error;
  if (data) {
    if (String((data as any).request_hash || "") !== params.requestHash) return { kind: "conflict" };
    return {
      kind: "replay",
      statusCode: Number((data as any).status_code ?? 200),
      payload: (data as any).response_snapshot_json ?? {},
    };
  }

  return { kind: "ok", key, requestHash: params.requestHash };
}

export async function storeUserIdempotencyResponse(params: {
  supabase: SupabaseClient;
  userId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  payload: any;
  correlationId?: string;
}) {
  const { error } = await params.supabase.from("user_idempotency_keys").insert({
    user_id: params.userId,
    endpoint: params.endpoint,
    idempotency_key: params.idempotencyKey,
    request_hash: params.requestHash,
    response_snapshot_json: params.payload ?? {},
    status_code: params.statusCode,
    correlation_id: params.correlationId ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}


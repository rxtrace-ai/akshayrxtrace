import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type CanonicalMetric = "unit" | "box" | "carton" | "pallet" | "seat" | "plant" | "handset";

export type EntitlementSnapshot = {
  state: string;
  trial_active: boolean;
  trial_expires_at: string | null;
  period_start: string | null;
  period_end: string | null;
  limits: Record<CanonicalMetric, number>;
  usage: Record<CanonicalMetric, number>;
  topups: Record<"unit" | "box" | "carton" | "pallet", number>;
  remaining: Record<CanonicalMetric, number>;
  blocked: boolean;
};

type OperationResult = {
  ok: boolean;
  metric: CanonicalMetric;
  remaining: number;
  consumed?: number;
  refunded?: number;
  base_consumed?: number;
  topup_consumed?: number;
  base_refunded?: number;
  topup_refunded?: number;
};

function toSafeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSnapshot(raw: any): EntitlementSnapshot {
  const metricKeys: CanonicalMetric[] = ["unit", "box", "carton", "pallet", "seat", "plant", "handset"];
  const quotaKeys: Array<"unit" | "box" | "carton" | "pallet"> = ["unit", "box", "carton", "pallet"];

  const limits = {} as Record<CanonicalMetric, number>;
  const usage = {} as Record<CanonicalMetric, number>;
  const remaining = {} as Record<CanonicalMetric, number>;
  const topups = {} as Record<"unit" | "box" | "carton" | "pallet", number>;

  for (const key of metricKeys) {
    limits[key] = toSafeNumber(raw?.limits?.[key]);
    usage[key] = toSafeNumber(raw?.usage?.[key]);
    remaining[key] = toSafeNumber(raw?.remaining?.[key]);
  }
  for (const key of quotaKeys) {
    topups[key] = toSafeNumber(raw?.topups?.[key]);
  }

  return {
    state: String(raw?.state || "NO_ACTIVE_SUBSCRIPTION"),
    trial_active: Boolean(raw?.trial_active),
    trial_expires_at: raw?.trial_expires_at ?? null,
    period_start: raw?.period_start ?? null,
    period_end: raw?.period_end ?? null,
    limits,
    usage,
    topups,
    remaining,
    blocked: Boolean(raw?.blocked),
  };
}

function normalizeOpResult(raw: any): OperationResult {
  return {
    ok: Boolean(raw?.ok),
    metric: (raw?.metric as CanonicalMetric) || "unit",
    remaining: toSafeNumber(raw?.remaining),
    consumed: raw?.consumed !== undefined ? toSafeNumber(raw?.consumed) : undefined,
    refunded: raw?.refunded !== undefined ? toSafeNumber(raw?.refunded) : undefined,
    base_consumed: raw?.base_consumed !== undefined ? toSafeNumber(raw?.base_consumed) : undefined,
    topup_consumed: raw?.topup_consumed !== undefined ? toSafeNumber(raw?.topup_consumed) : undefined,
    base_refunded: raw?.base_refunded !== undefined ? toSafeNumber(raw?.base_refunded) : undefined,
    topup_refunded: raw?.topup_refunded !== undefined ? toSafeNumber(raw?.topup_refunded) : undefined,
  };
}

export async function getCompanyEntitlementSnapshot(
  supabase: SupabaseClient,
  companyId: string,
  atIso?: string
): Promise<EntitlementSnapshot> {
  const { data, error } = await supabase.rpc("get_company_entitlement_snapshot", {
    p_company_id: companyId,
    p_at: atIso || new Date().toISOString(),
  });
  if (error) throw error;
  const payload = Array.isArray(data) ? data[0] : data;
  return normalizeSnapshot(payload || {});
}

export async function consumeCanonicalEntitlement(params: {
  companyId: string;
  metric: CanonicalMetric;
  quantity: number;
  requestId?: string;
  supabase?: ReturnType<typeof getSupabaseAdmin>;
}): Promise<OperationResult> {
  const supabase = params.supabase ?? getSupabaseAdmin();
  const { data, error } = await supabase.rpc("consume_entitlement", {
    p_company_id: params.companyId,
    p_metric: params.metric,
    p_qty: params.quantity,
    p_request_id: params.requestId || randomUUID(),
  });
  if (error) throw error;
  const payload = Array.isArray(data) ? data[0] : data;
  return normalizeOpResult(payload || {});
}

export async function refundCanonicalEntitlement(params: {
  companyId: string;
  metric: CanonicalMetric;
  quantity: number;
  requestId?: string;
  supabase?: ReturnType<typeof getSupabaseAdmin>;
}): Promise<OperationResult> {
  const supabase = params.supabase ?? getSupabaseAdmin();
  const { data, error } = await supabase.rpc("refund_entitlement", {
    p_company_id: params.companyId,
    p_metric: params.metric,
    p_qty: params.quantity,
    p_request_id: params.requestId || randomUUID(),
  });
  if (error) throw error;
  const payload = Array.isArray(data) ? data[0] : data;
  return normalizeOpResult(payload || {});
}

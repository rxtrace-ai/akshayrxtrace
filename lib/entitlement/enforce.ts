import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { trackUsage } from "@/lib/usage/tracking";
import { UsageType } from "@/lib/entitlement/usageTypes";
import {
  consumeCanonicalEntitlement,
  refundCanonicalEntitlement,
  type CanonicalMetric,
} from "@/lib/entitlement/canonical";

export type EntitlementDecision = {
  allow: boolean;
  reason_code: string;
  remaining: number;
  consumed: number;
  fallback_used: "base" | "bonus" | "wallet" | "trial" | null;
};

const usageTypeToMetric: Record<UsageType, CanonicalMetric> = {
  [UsageType.UNIT_LABEL]: "unit",
  [UsageType.BOX_LABEL]: "box",
  [UsageType.CARTON_LABEL]: "carton",
  [UsageType.PALLET_LABEL]: "pallet",
  [UsageType.SSCC_LABEL]: "pallet",
  [UsageType.LABEL_PREVIEW]: "pallet",
  [UsageType.BULK_GENERATION]: "pallet",
  [UsageType.ERP_INGEST]: "pallet",
};

const usageTypeToMetricType: Record<UsageType, "UNIT" | "BOX" | "CARTON" | "SSCC" | "API"> = {
  [UsageType.UNIT_LABEL]: "UNIT",
  [UsageType.BOX_LABEL]: "BOX",
  [UsageType.CARTON_LABEL]: "CARTON",
  [UsageType.PALLET_LABEL]: "SSCC",
  [UsageType.SSCC_LABEL]: "SSCC",
  [UsageType.LABEL_PREVIEW]: "SSCC",
  [UsageType.BULK_GENERATION]: "SSCC",
  [UsageType.ERP_INGEST]: "API",
};

const nonConsumingUsageTypes: Set<UsageType> = new Set([
  UsageType.LABEL_PREVIEW,
  UsageType.ERP_INGEST,
]);

function mapErrorToReasonCode(error?: string): EntitlementDecision["reason_code"] {
  const value = (error || "").toUpperCase();
  if (value.includes("TRIAL_EXPIRED")) return "TRIAL_EXPIRED";
  if (value.includes("NO_ACTIVE_SUBSCRIPTION")) return "NO_ACTIVE_SUBSCRIPTION";
  if (value.includes("QUOTA_EXCEEDED")) return "QUOTA_EXCEEDED";
  if (value.includes("UNSUPPORTED_METRIC")) return "INVALID_USAGE_TYPE";
  return "QUOTA_EXCEEDED";
}

export async function enforceEntitlement({
  companyId,
  usageType,
  quantity,
  requestId,
  metadata,
}: {
  companyId: string;
  usageType: UsageType;
  quantity: number;
  requestId?: string;
  metadata?: Record<string, any>;
}): Promise<EntitlementDecision> {
  if (!companyId || typeof companyId !== "string") {
    return {
      allow: false,
      reason_code: "INVALID_USAGE_TYPE",
      remaining: 0,
      consumed: 0,
      fallback_used: null,
    };
  }
  if (!Object.values(UsageType).includes(usageType)) {
    return {
      allow: false,
      reason_code: "INVALID_USAGE_TYPE",
      remaining: 0,
      consumed: 0,
      fallback_used: null,
    };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      allow: false,
      reason_code: "INVALID_USAGE_TYPE",
      remaining: 0,
      consumed: 0,
      fallback_used: null,
    };
  }

  if (nonConsumingUsageTypes.has(usageType)) {
    return {
      allow: true,
      reason_code: "NON_CONSUMING",
      remaining: -1,
      consumed: 0,
      fallback_used: null,
    };
  }

  const metric = usageTypeToMetric[usageType];
  const finalRequestId =
    typeof requestId === "string" && requestId.trim()
      ? requestId.trim()
      : typeof metadata?.request_id === "string" && metadata.request_id.trim()
        ? metadata.request_id.trim()
        : randomUUID();

  try {
    const consume = await consumeCanonicalEntitlement({
      companyId,
      metric,
      quantity,
      requestId: finalRequestId,
      supabase: getSupabaseAdmin(),
    });

    trackUsage(getSupabaseAdmin(), {
      company_id: companyId,
      metric_type: usageTypeToMetricType[usageType],
      quantity,
      source: "api",
      reference_id: metadata?.source ? String(metadata.source) : undefined,
    }).catch(() => undefined);

    return {
      allow: Boolean(consume.ok),
      reason_code: consume.ok ? "ALLOWED" : "QUOTA_EXCEEDED",
      remaining: Number(consume.remaining || 0),
      consumed: consume.ok ? quantity : 0,
      fallback_used: "base",
    };
  } catch (error: any) {
    return {
      allow: false,
      reason_code: mapErrorToReasonCode(error?.message || String(error)),
      remaining: 0,
      consumed: 0,
      fallback_used: null,
    };
  }
}

export async function refundEntitlement(params: {
  companyId: string;
  usageType: UsageType;
  quantity: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { companyId, usageType, quantity } = params;

  if (!companyId || !Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "invalid_refund_input" };
  }
  if (!Object.values(UsageType).includes(usageType)) {
    return { ok: false, error: "invalid_usage_type" };
  }
  if (nonConsumingUsageTypes.has(usageType)) {
    return { ok: true };
  }

  try {
    await refundCanonicalEntitlement({
      companyId,
      metric: usageTypeToMetric[usageType],
      quantity,
      requestId: randomUUID(),
      supabase: getSupabaseAdmin(),
    });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

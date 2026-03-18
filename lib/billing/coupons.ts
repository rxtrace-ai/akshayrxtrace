import type { SupabaseClient } from "@supabase/supabase-js";

function normalizeCode(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type ResolvedCoupon = {
  id: string;
  code: string;
  discount_type: "percentage" | "flat";
  discount_value: number;
  maxDiscountPaise: number | null;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  used_count: number;
};

export async function resolveActiveCoupon(
  supabase: SupabaseClient,
  rawCode: unknown
): Promise<ResolvedCoupon | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { data, error } = await supabase
    .from("coupons")
    .select("id, code, discount_type, discount_value, max_discount_paise, active, valid_from, valid_until, usage_limit, used_count")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const isActive = Boolean(data.active);
  if (!isActive) return null;

  const validFrom = data.valid_from ? new Date(String(data.valid_from)) : null;
  const validUntil = data.valid_until ? new Date(String(data.valid_until)) : null;
  if (validFrom && !Number.isNaN(validFrom.getTime()) && validFrom.getTime() > nowDate.getTime()) {
    return null;
  }
  if (validUntil && !Number.isNaN(validUntil.getTime()) && validUntil.getTime() < nowDate.getTime()) {
    return null;
  }

  const usageLimit = data.usage_limit == null ? null : Number(data.usage_limit);
  const usageCount = Number(data.used_count || 0);
  if (usageLimit !== null && Number.isFinite(usageLimit) && usageCount >= usageLimit) {
    return null;
  }

  return {
    id: String(data.id),
    code: String(data.code),
    discount_type: data.discount_type === "flat" ? "flat" : "percentage",
    discount_value: Math.max(0, Math.trunc(toNumber(data.discount_value, 0))),
    maxDiscountPaise: data.max_discount_paise == null ? null : Math.max(0, Math.trunc(toNumber(data.max_discount_paise, 0))),
    active: isActive,
    valid_from: data.valid_from ? String(data.valid_from) : null,
    valid_until: data.valid_until ? String(data.valid_until) : null,
    usage_limit: usageLimit,
    used_count: usageCount,
  };
}

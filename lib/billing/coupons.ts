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
  type: "percentage" | "flat";
  value: number;
  scope: "subscription" | "addons" | "both";
};

export function computeCouponDiscountPaise(
  coupon: ResolvedCoupon | null,
  addonsSubtotalPaise: number
): number {
  if (!coupon) return 0;
  if (!["addons", "both"].includes(coupon.scope)) return 0;

  const safeSubtotal = Math.max(0, Math.trunc(addonsSubtotalPaise));
  if (safeSubtotal <= 0) return 0;

  if (coupon.type === "percentage") {
    const pct = Math.min(Math.max(coupon.value, 0), 100);
    return Math.min(safeSubtotal, Math.round((safeSubtotal * pct) / 100));
  }

  const flatPaise = Math.max(0, Math.round(coupon.value * 100));
  return Math.min(safeSubtotal, flatPaise);
}

export async function resolveActiveCoupon(
  supabase: SupabaseClient,
  rawCode: unknown
): Promise<ResolvedCoupon | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("discounts")
    .select("id, code, type, value, scope, is_active, valid_from, valid_to, usage_limit, usage_count")
    .eq("code", code)
    .eq("is_active", true)
    .lte("valid_from", now)
    .or(`valid_to.is.null,valid_to.gte.${now}`)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const usageLimit = data.usage_limit == null ? null : Number(data.usage_limit);
  const usageCount = Number(data.usage_count || 0);
  if (usageLimit !== null && Number.isFinite(usageLimit) && usageCount >= usageLimit) {
    return null;
  }

  return {
    id: String(data.id),
    code: String(data.code),
    type: data.type === "flat" ? "flat" : "percentage",
    value: toNumber(data.value, 0),
    scope: data.scope === "subscription" || data.scope === "addons" ? data.scope : "both",
  };
}

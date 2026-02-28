import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CheckoutMetric = "seat" | "plant" | "handset" | "unit" | "box" | "carton" | "pallet";
export type AddOnKind = "structural" | "variable_quota";
export type BillingMode = "recurring" | "one_time";
export type CouponScope = "subscription" | "addons" | "both";

export type ActivePlan = {
  template_id: string;
  template_name: string;
  billing_cycle: "monthly" | "yearly";
  amount_from_razorpay: number;
  version_id: string;
  version_number: number;
  limits: {
    unit: number;
    box: number;
    carton: number;
    pallet: number;
    seat: number;
    plant: number;
    handset: number;
    grace_unit: number;
    grace_box: number;
    grace_carton: number;
    grace_pallet: number;
  };
};

export type ActiveAddOn = {
  id: string;
  name: string;
  price: number;
  unit: string;
  addon_kind: AddOnKind;
  entitlement_key: CheckoutMetric;
  billing_mode: BillingMode;
  recurring: boolean;
  is_active: boolean;
};

export type ActiveCoupon = {
  id: string;
  code: string;
  type: "percentage" | "flat";
  value: number;
  scope: CouponScope;
  usage_limit: number | null;
  usage_count: number;
  valid_from: string;
  valid_to: string | null;
  razorpay_offer_id: string | null;
};

export type CheckoutQuoteInput = {
  companyId: string;
  ownerUserId: string;
  planTemplateId: string;
  structuralAddons?: Array<{ addon_id: string; quantity: number }>;
  variableTopups?: Array<{ addon_id: string; quantity: number }>;
  variableQuota?: Partial<Record<"unit" | "box" | "carton" | "pallet", number>>;
  couponCode?: string | null;
};

export type CheckoutQuotePayload = {
  company_id: string;
  owner_user_id: string;
  generated_at: string;
  expires_at: string;
  selected_plan_template_id: string;
  selected_plan_version_id: string;
  plan: {
    name: string;
    billing_cycle: "monthly" | "yearly";
    amount_paise: number;
    limits: ActivePlan["limits"];
  };
  structural_addons: Array<{
    addon_id: string;
    name: string;
    entitlement_key: CheckoutMetric;
    quantity: number;
    unit_price_paise: number;
    line_total_paise: number;
  }>;
  variable_topups: Array<{
    addon_id: string;
    name: string;
    entitlement_key: CheckoutMetric;
    quantity: number;
    unit_price_paise: number;
    line_total_paise: number;
  }>;
  coupon: {
    id: string;
    code: string;
    type: "percentage" | "flat";
    value: number;
    scope: CouponScope;
    discount_paise: number;
    razorpay_offer_id: string | null;
  } | null;
  totals: {
    currency: "INR";
    subscription_paise: number;
    structural_addons_paise: number;
    variable_topups_paise: number;
    discount_paise: number;
    grand_total_paise: number;
  };
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value: unknown): number {
  const parsed = Math.trunc(toNumber(value, 0));
  return parsed > 0 ? parsed : 0;
}

function toPaiseFromINR(value: unknown): number {
  const parsed = toNumber(value, 0);
  return Math.max(0, Math.round(parsed * 100));
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

export function checkoutQuoteHash(payload: CheckoutQuotePayload): string {
  return crypto.createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

function getCheckoutSigningSecret(): string {
  const value =
    process.env.CHECKOUT_QUOTE_SECRET?.trim() ||
    process.env.RAZORPAY_KEY_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) {
    throw new Error("CHECKOUT_SIGNING_SECRET_MISSING");
  }
  return value;
}

export function signCheckoutQuote(payload: CheckoutQuotePayload): { quote_hash: string; signature: string } {
  const quoteHash = checkoutQuoteHash(payload);
  const signature = crypto.createHmac("sha256", getCheckoutSigningSecret()).update(quoteHash).digest("hex");
  return { quote_hash: quoteHash, signature };
}

export function verifyCheckoutQuoteSignature(payload: CheckoutQuotePayload, signature: string): boolean {
  if (!signature?.trim()) return false;
  const { signature: expected } = signCheckoutQuote(payload);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function loadCheckoutCatalog(supabase: SupabaseClient): Promise<{
  plans: ActivePlan[];
  addOns: ActiveAddOn[];
  coupons: ActiveCoupon[];
}> {
  const { data: templates, error: templateError } = await supabase
    .from("subscription_plan_templates")
    .select("id, name, billing_cycle, amount_from_razorpay, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (templateError) throw new Error(templateError.message);

  const templateIds = (templates || []).map((row: any) => row.id);
  const { data: versions, error: versionError } = templateIds.length
    ? await supabase
        .from("subscription_plan_versions")
        .select(
          "id, template_id, version_number, unit_limit, box_limit, carton_limit, pallet_limit, seat_limit, plant_limit, handset_limit, grace_unit, grace_box, grace_carton, grace_pallet, is_active"
        )
        .in("template_id", templateIds)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
    : { data: [], error: null as any };
  if (versionError) throw new Error(versionError.message);

  const activeVersionByTemplate = new Map<string, any>();
  for (const row of versions || []) {
    if (!activeVersionByTemplate.has((row as any).template_id)) {
      activeVersionByTemplate.set((row as any).template_id, row);
    }
  }

  const plans: ActivePlan[] = (templates || [])
    .map((template: any) => {
      const version = activeVersionByTemplate.get(template.id);
      if (!version) return null;
      return {
        template_id: String(template.id),
        template_name: String(template.name || ""),
        billing_cycle: template.billing_cycle === "yearly" ? "yearly" : "monthly",
        amount_from_razorpay: Math.max(0, Math.trunc(toNumber(template.amount_from_razorpay, 0))),
        version_id: String(version.id),
        version_number: toPositiveInt(version.version_number),
        limits: {
          unit: toPositiveInt(version.unit_limit),
          box: toPositiveInt(version.box_limit),
          carton: toPositiveInt(version.carton_limit),
          pallet: toPositiveInt(version.pallet_limit),
          seat: toPositiveInt(version.seat_limit),
          plant: toPositiveInt(version.plant_limit),
          handset: toPositiveInt(version.handset_limit),
          grace_unit: toPositiveInt(version.grace_unit),
          grace_box: toPositiveInt(version.grace_box),
          grace_carton: toPositiveInt(version.grace_carton),
          grace_pallet: toPositiveInt(version.grace_pallet),
        },
      } as ActivePlan;
    })
    .filter(Boolean) as ActivePlan[];

  const { data: addOnRows, error: addOnError } = await supabase
    .from("add_ons")
    .select("id, name, price, unit, addon_kind, entitlement_key, billing_mode, recurring, is_active, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (addOnError) throw new Error(addOnError.message);

  const addOns: ActiveAddOn[] = (addOnRows || []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name || ""),
    price: toNumber(row.price, 0),
    unit: String(row.unit || "unit"),
    addon_kind: row.addon_kind === "structural" ? "structural" : "variable_quota",
    entitlement_key: row.entitlement_key as CheckoutMetric,
    billing_mode: row.billing_mode === "recurring" ? "recurring" : "one_time",
    recurring: row.recurring === true,
    is_active: row.is_active === true,
  }));

  const nowIso = new Date().toISOString();
  const { data: couponRows, error: couponError } = await supabase
    .from("discounts")
    .select("id, code, type, value, scope, usage_limit, usage_count, valid_from, valid_to, is_active, razorpay_offer_id")
    .eq("is_active", true);
  if (couponError) throw new Error(couponError.message);

  const coupons: ActiveCoupon[] = (couponRows || [])
    .map((row: any) => ({
      id: String(row.id),
      code: String(row.code || "").toUpperCase(),
      type: row.type === "flat" ? "flat" : "percentage",
      value: toNumber(row.value, 0),
      scope:
        row.scope === "subscription" || row.scope === "addons" || row.scope === "both"
          ? (row.scope as CouponScope)
          : "both",
      usage_limit: row.usage_limit === null ? null : toPositiveInt(row.usage_limit),
      usage_count: toPositiveInt(row.usage_count),
      valid_from: row.valid_from || nowIso,
      valid_to: row.valid_to || null,
      razorpay_offer_id: row.razorpay_offer_id || null,
    }))
    .filter((coupon) => {
      const now = new Date(nowIso).getTime();
      const from = new Date(coupon.valid_from).getTime();
      const to = coupon.valid_to ? new Date(coupon.valid_to).getTime() : null;
      if (Number.isNaN(from) || now < from) return false;
      if (to !== null && !Number.isNaN(to) && now > to) return false;
      if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) return false;
      return true;
    });

  return { plans, addOns, coupons };
}

function normalizeSelectionArray(input: unknown): Array<{ addon_id: string; quantity: number }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => ({
      addon_id: String((entry as any)?.addon_id || "").trim(),
      quantity: toPositiveInt((entry as any)?.quantity),
    }))
    .filter((entry) => entry.addon_id && entry.quantity > 0);
}

function mergeSelectionByAddonId(entries: Array<{ addon_id: string; quantity: number }>) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.addon_id, (totals.get(entry.addon_id) || 0) + entry.quantity);
  }
  return Array.from(totals.entries()).map(([addon_id, quantity]) => ({ addon_id, quantity }));
}

export function normalizeVariableQuotaInput(
  input: Partial<Record<"unit" | "box" | "carton" | "pallet", number>> | undefined,
  addOns: ActiveAddOn[]
): Array<{ addon_id: string; quantity: number }> {
  if (!input) return [];
  const variableCandidates = addOns.filter(
    (row) => row.addon_kind === "variable_quota" && row.billing_mode === "one_time"
  );
  const byKey = new Map<string, ActiveAddOn>();
  for (const addon of variableCandidates) {
    if (!byKey.has(addon.entitlement_key)) byKey.set(addon.entitlement_key, addon);
  }
  const output: Array<{ addon_id: string; quantity: number }> = [];
  for (const key of ["unit", "box", "carton", "pallet"] as const) {
    const qty = toPositiveInt(input[key]);
    if (!qty) continue;
    const addon = byKey.get(key);
    if (!addon) throw new Error(`NO_VARIABLE_ADDON_FOR_${key.toUpperCase()}`);
    output.push({ addon_id: addon.id, quantity: qty });
  }
  return output;
}

function applyCouponDiscount(params: {
  coupon: ActiveCoupon | null;
  subscriptionSubtotal: number;
  addonsSubtotal: number;
}): {
  discountTotal: number;
} {
  const { coupon, subscriptionSubtotal, addonsSubtotal } = params;
  if (!coupon) return { discountTotal: 0 };

  let eligibleSubtotal = 0;
  if (coupon.scope === "subscription") {
    eligibleSubtotal = subscriptionSubtotal;
  } else if (coupon.scope === "addons") {
    eligibleSubtotal = addonsSubtotal;
  } else {
    eligibleSubtotal = subscriptionSubtotal + addonsSubtotal;
  }
  if (eligibleSubtotal <= 0) return { discountTotal: 0 };

  let discount = 0;
  if (coupon.type === "percentage") {
    const pct = Math.min(Math.max(coupon.value, 0), 100);
    discount = Math.round((eligibleSubtotal * pct) / 100);
  } else {
    discount = toPaiseFromINR(coupon.value);
  }
  return { discountTotal: Math.max(0, Math.min(discount, eligibleSubtotal)) };
}

export function buildCheckoutQuote(
  input: CheckoutQuoteInput,
  catalog: {
    plans: ActivePlan[];
    addOns: ActiveAddOn[];
    coupons: ActiveCoupon[];
  }
): CheckoutQuotePayload {
  const plan = catalog.plans.find((row) => row.template_id === input.planTemplateId);
  if (!plan) throw new Error("PLAN_NOT_AVAILABLE");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  const rawStructuralSelections = normalizeSelectionArray(input.structuralAddons);
  const rawVariableSelections = normalizeSelectionArray(input.variableTopups);
  const mappedVariableFromKeys = normalizeVariableQuotaInput(input.variableQuota, catalog.addOns);

  const structuralSelections = mergeSelectionByAddonId(rawStructuralSelections);
  const variableSelections = mergeSelectionByAddonId([...rawVariableSelections, ...mappedVariableFromKeys]);

  const addOnsById = new Map(catalog.addOns.map((addon) => [addon.id, addon]));
  const structuralLines: CheckoutQuotePayload["structural_addons"] = [];
  for (const selection of structuralSelections) {
    const addon = addOnsById.get(selection.addon_id);
    if (!addon) throw new Error("ADDON_NOT_AVAILABLE");
    if (!(addon.addon_kind === "structural" && addon.billing_mode === "recurring")) {
      throw new Error("INVALID_STRUCTURAL_ADDON_SELECTION");
    }
    structuralLines.push({
      addon_id: addon.id,
      name: addon.name,
      entitlement_key: addon.entitlement_key,
      quantity: selection.quantity,
      unit_price_paise: toPaiseFromINR(addon.price),
      line_total_paise: toPaiseFromINR(addon.price) * selection.quantity,
    });
  }

  const variableLines: CheckoutQuotePayload["variable_topups"] = [];
  for (const selection of variableSelections) {
    const addon = addOnsById.get(selection.addon_id);
    if (!addon) throw new Error("ADDON_NOT_AVAILABLE");
    if (!(addon.addon_kind === "variable_quota" && addon.billing_mode === "one_time")) {
      throw new Error("INVALID_VARIABLE_ADDON_SELECTION");
    }
    variableLines.push({
      addon_id: addon.id,
      name: addon.name,
      entitlement_key: addon.entitlement_key,
      quantity: selection.quantity,
      unit_price_paise: toPaiseFromINR(addon.price),
      line_total_paise: toPaiseFromINR(addon.price) * selection.quantity,
    });
  }

  const subscriptionSubtotal = plan.amount_from_razorpay;
  const structuralSubtotal = structuralLines.reduce((sum, line) => sum + line.line_total_paise, 0);
  const variableSubtotal = variableLines.reduce((sum, line) => sum + line.line_total_paise, 0);
  const addonsSubtotal = structuralSubtotal + variableSubtotal;

  const couponCode = String(input.couponCode || "").trim().toUpperCase();
  const coupon =
    couponCode.length > 0
      ? catalog.coupons.find((row) => row.code === couponCode) || null
      : null;
  if (couponCode && !coupon) throw new Error("COUPON_INVALID");

  const { discountTotal } = applyCouponDiscount({
    coupon,
    subscriptionSubtotal,
    addonsSubtotal,
  });
  const grandTotal = Math.max(0, subscriptionSubtotal + addonsSubtotal - discountTotal);

  return {
    company_id: input.companyId,
    owner_user_id: input.ownerUserId,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    selected_plan_template_id: plan.template_id,
    selected_plan_version_id: plan.version_id,
    plan: {
      name: plan.template_name,
      billing_cycle: plan.billing_cycle,
      amount_paise: plan.amount_from_razorpay,
      limits: plan.limits,
    },
    structural_addons: structuralLines,
    variable_topups: variableLines,
    coupon: coupon
      ? {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          scope: coupon.scope,
          discount_paise: discountTotal,
          razorpay_offer_id: coupon.razorpay_offer_id,
        }
      : null,
    totals: {
      currency: "INR",
      subscription_paise: subscriptionSubtotal,
      structural_addons_paise: structuralSubtotal,
      variable_topups_paise: variableSubtotal,
      discount_paise: discountTotal,
      grand_total_paise: grandTotal,
    },
  };
}


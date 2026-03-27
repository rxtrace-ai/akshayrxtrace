import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedCoupon } from "@/lib/billing/coupons";
import { buildPricingBreakdown } from "@/lib/billing/pricing";

export type CheckoutMetric = "seat" | "plant" | "handset" | "unit" | "box" | "carton" | "pallet";
export type AddOnKind = "structural" | "variable_quota";
export type BillingMode = "recurring" | "one_time";

export type ActivePlan = {
  template_id: string;
  template_name: string;
  description: string | null;
  billing_cycle: "monthly" | "yearly";
  plan_price_paise: number;
  pricing_unit_size: number;
  version_id: string;
  version_number: number;
  quota_units: {
    unit: number;
    box: number;
    carton: number;
    pallet: number;
  };
  quotas: {
    unit: number;
    box: number;
    carton: number;
    pallet: number;
  };
  capacities: {
    seat: number;
    plant: number;
    handset: number;
  };
};

export type ActiveAddOn = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  pricing_unit_size: number;
  addon_kind: AddOnKind;
  entitlement_key: CheckoutMetric;
  billing_mode: BillingMode;
  recurring: boolean;
  is_active: boolean;
};

export type CheckoutQuoteInput = {
  companyId: string;
  ownerUserId: string;
  planTemplateId?: string | null;
  capacityAddons?: Array<{ addon_id: string; quantity: number }>;
  codeAddons?: Array<{ addon_id: string; quantity: number }>;
  coupon?: ResolvedCoupon | null;
};

export type CheckoutQuotePayload = {
  company_id: string;
  owner_user_id: string;
  generated_at: string;
  expires_at: string;
  checkout_mode: "recurring_plan" | "one_time_addon";
  selected_plan_template_id: string | null;
  selected_plan_version_id: string | null;
  plan: {
    name: string;
    description: string | null;
    billing_cycle: "monthly" | "yearly";
    plan_price_paise: number;
    pricing_unit_size: number;
    quota_units: ActivePlan["quota_units"];
    quotas: ActivePlan["quotas"];
    capacities: ActivePlan["capacities"];
  };
  capacity_addons: Array<{
    addon_id: string;
    name: string;
    entitlement_key: CheckoutMetric;
    quantity: number;
    unit_price_paise: number;
    line_total_paise: number;
    allocated_capacity: number;
  }>;
  code_addons: Array<{
    addon_id: string;
    name: string;
    entitlement_key: CheckoutMetric;
    quantity: number;
    pricing_unit_size: number;
    allocated_quota: number;
    unit_price_paise: number;
    line_total_paise: number;
  }>;
  coupon: null | {
    id: string;
    code: string;
    discount_type: "percentage" | "flat";
    discount_value: number;
    max_discount_paise: number | null;
  };
  totals: {
    currency: "INR";
    subscription_paise: number;
    capacity_addons_paise: number;
    code_addons_paise: number;
    addons_paise: number;
    discount_paise: number;
    taxable_subtotal_paise: number;
    gst_rate_percent: number;
    gst_paise: number;
    addons_payable_paise: number;
    payable_today_paise: number;
    grand_total_paise: number;
    final_total_paise: number;
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
  const encoder = new TextEncoder();
  const a = encoder.encode(signature);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function loadCheckoutCatalog(supabase: SupabaseClient): Promise<{
  plans: ActivePlan[];
  addOns: ActiveAddOn[];
}> {
  const { data: templates, error: templateError } = await supabase
    .from("subscription_plan_templates")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (templateError) throw new Error(templateError.message);

  const templateIds = (templates || []).map((row: any) => row.id);
  const { data: versions, error: versionError } = templateIds.length
    ? await supabase
        .from("subscription_plan_versions")
        .select("*")
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
      const pricingUnitSize = Math.max(1, toPositiveInt(template.pricing_unit_size || 1));
      const quotaUnits = {
        unit: toPositiveInt(version.unit_quota_units || Math.floor(toPositiveInt(version.unit_limit) / pricingUnitSize)),
        box: toPositiveInt(version.box_quota_units || Math.floor(toPositiveInt(version.box_limit) / pricingUnitSize)),
        carton: toPositiveInt(version.carton_quota_units || Math.floor(toPositiveInt(version.carton_limit) / pricingUnitSize)),
        pallet: toPositiveInt(version.pallet_quota_units || Math.floor(toPositiveInt(version.pallet_limit) / pricingUnitSize)),
      };
      return {
        template_id: String(template.id),
        template_name: String(template.name || ""),
        description: template.description || null,
        billing_cycle: template.billing_cycle === "yearly" ? "yearly" : "monthly",
        plan_price_paise: Math.max(0, Math.trunc(toNumber(template.plan_price ?? template.amount_from_razorpay, 0))),
        pricing_unit_size: pricingUnitSize,
        version_id: String(version.id),
        version_number: toPositiveInt(version.version_number),
        quota_units: quotaUnits,
        quotas: {
          unit: toPositiveInt(version.unit_limit),
          box: toPositiveInt(version.box_limit),
          carton: toPositiveInt(version.carton_limit),
          pallet: toPositiveInt(version.pallet_limit),
        },
        capacities: {
          seat: toPositiveInt(version.seat_limit),
          plant: toPositiveInt(version.plant_limit),
          handset: toPositiveInt(version.handset_limit),
        },
      } as ActivePlan;
    })
    .filter(Boolean) as ActivePlan[];

  const { data: addOnRows, error: addOnError } = await supabase
    .from("add_ons")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (addOnError) throw new Error(addOnError.message);

  const addOns: ActiveAddOn[] = (addOnRows || []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name || ""),
    description: row.description || null,
    price: toNumber(row.price, 0),
    unit: String(row.unit || "unit"),
    pricing_unit_size: Math.max(1, toPositiveInt(row.pricing_unit_size || 1)),
    addon_kind: row.addon_kind === "structural" ? "structural" : "variable_quota",
    entitlement_key: row.entitlement_key as CheckoutMetric,
    billing_mode: row.billing_mode === "recurring" ? "recurring" : "one_time",
    recurring: row.recurring === true,
    is_active: row.is_active === true,
  }));

  return { plans, addOns };
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

export function buildCheckoutQuote(
  input: CheckoutQuoteInput,
  catalog: {
    plans: ActivePlan[];
    addOns: ActiveAddOn[];
  }
): CheckoutQuotePayload {
  const normalizedPlanTemplateId = String(input.planTemplateId || "").trim();
  const plan = normalizedPlanTemplateId
    ? catalog.plans.find((row) => row.template_id === normalizedPlanTemplateId) || null
    : null;
  if (normalizedPlanTemplateId && !plan) throw new Error("PLAN_NOT_AVAILABLE");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  const capacitySelections = mergeSelectionByAddonId(normalizeSelectionArray(input.capacityAddons));
  const codeSelections = mergeSelectionByAddonId(normalizeSelectionArray(input.codeAddons));

  const addOnsById = new Map(catalog.addOns.map((addon) => [addon.id, addon]));
  const capacityLines: CheckoutQuotePayload["capacity_addons"] = [];
  for (const selection of capacitySelections) {
    const addon = addOnsById.get(selection.addon_id);
    if (!addon) throw new Error("ADDON_NOT_AVAILABLE");
    if (!(addon.addon_kind === "structural" && addon.billing_mode === "recurring")) {
      throw new Error("INVALID_CAPACITY_ADDON_SELECTION");
    }
    const unitPrice = toPaiseFromINR(addon.price);
    capacityLines.push({
      addon_id: addon.id,
      name: addon.name,
      entitlement_key: addon.entitlement_key,
      quantity: selection.quantity,
      allocated_capacity: selection.quantity,
      unit_price_paise: unitPrice,
      line_total_paise: unitPrice * selection.quantity,
    });
  }

  const codeLines: CheckoutQuotePayload["code_addons"] = [];
  for (const selection of codeSelections) {
    const addon = addOnsById.get(selection.addon_id);
    if (!addon) throw new Error("ADDON_NOT_AVAILABLE");
    if (!(addon.addon_kind === "variable_quota" && addon.billing_mode === "one_time")) {
      throw new Error("INVALID_CODE_ADDON_SELECTION");
    }
    const unitPrice = toPaiseFromINR(addon.price);
    codeLines.push({
      addon_id: addon.id,
      name: addon.name,
      entitlement_key: addon.entitlement_key,
      quantity: selection.quantity,
      pricing_unit_size: addon.pricing_unit_size,
      allocated_quota: selection.quantity * addon.pricing_unit_size,
      unit_price_paise: unitPrice,
      line_total_paise: unitPrice * selection.quantity,
    });
  }

  const subscriptionSubtotal = plan?.plan_price_paise || 0;
  const capacitySubtotal = capacityLines.reduce((sum, line) => sum + line.line_total_paise, 0);
  const codeSubtotal = codeLines.reduce((sum, line) => sum + line.line_total_paise, 0);
  const addonsSubtotal = capacitySubtotal + codeSubtotal;
  if (!plan && addonsSubtotal <= 0) {
    throw new Error("CHECKOUT_ITEM_REQUIRED");
  }
  const pricing = buildPricingBreakdown({
    subscriptionSubtotalPaise: subscriptionSubtotal,
    addonsSubtotalPaise: addonsSubtotal,
    coupon: input.coupon || null,
  });

  return {
    company_id: input.companyId,
    owner_user_id: input.ownerUserId,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    checkout_mode: plan ? "recurring_plan" : "one_time_addon",
    selected_plan_template_id: plan?.template_id || null,
    selected_plan_version_id: plan?.version_id || null,
    plan: {
      name: plan?.template_name || "Add-ons only",
      description: plan?.description || null,
      billing_cycle: plan?.billing_cycle || "monthly",
      plan_price_paise: plan?.plan_price_paise || 0,
      pricing_unit_size: plan?.pricing_unit_size || 1,
      quota_units: plan?.quota_units || { unit: 0, box: 0, carton: 0, pallet: 0 },
      quotas: plan?.quotas || { unit: 0, box: 0, carton: 0, pallet: 0 },
      capacities: plan?.capacities || { seat: 0, plant: 0, handset: 0 },
    },
    capacity_addons: capacityLines,
    code_addons: codeLines,
    coupon: input.coupon
      ? {
          id: input.coupon.id,
          code: input.coupon.code,
          discount_type: input.coupon.discount_type,
          discount_value: input.coupon.discount_value,
          max_discount_paise: input.coupon.maxDiscountPaise,
        }
      : null,
    totals: {
      currency: pricing.currency,
      subscription_paise: pricing.subscription_paise,
      capacity_addons_paise: capacitySubtotal,
      code_addons_paise: codeSubtotal,
      addons_paise: pricing.addons_paise,
      discount_paise: pricing.discount_paise,
      taxable_subtotal_paise: pricing.taxable_subtotal_paise,
      gst_rate_percent: pricing.gst_rate_percent,
      gst_paise: pricing.gst_paise,
      addons_payable_paise: pricing.addons_payable_paise,
      payable_today_paise: pricing.payable_today_paise,
      grand_total_paise: pricing.grand_total_paise,
      final_total_paise: pricing.final_total_paise,
    },
  };
}

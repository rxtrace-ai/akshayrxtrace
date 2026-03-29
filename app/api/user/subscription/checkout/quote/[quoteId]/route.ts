import { apiJson } from "@/lib/api/response";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function asArray<T = Record<string, any>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export async function GET(_: Request, context: { params: Promise<{ quoteId: string }> }) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { quoteId } = await context.params;
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    return apiJson({ error: "QUOTE_ID_REQUIRED" }, { status: 400 });
  }

  const { data: quote, error } = await owner.supabase
    .from("quotes")
    .select("*")
    .eq("id", normalizedQuoteId)
    .eq("company_id", owner.companyId)
    .eq("user_id", owner.userId)
    .maybeSingle();

  if (error) {
    return apiJson({ error: error.message }, { status: 500 });
  }
  if (!quote) {
    return apiJson({ error: "QUOTE_NOT_FOUND" }, { status: 404 });
  }

  const planSnapshot = asObject((quote as any).plan_snapshot_json);
  const addonsSnapshot = asObject((quote as any).addons_json);
  const totalsSnapshot = asObject((quote as any).totals_snapshot_json);
  const couponSnapshot = asObject((quote as any).coupon_snapshot_json);
  const capacityAddons = asArray(addonsSnapshot.capacity_addons);
  const codeAddons = asArray(addonsSnapshot.code_addons);
  const hasPlan = Object.keys(planSnapshot).length > 0;
  const hasCapacity = capacityAddons.length > 0;
  const hasCodes = codeAddons.length > 0;
  const storedStatus = String((quote as any).status || "active").trim().toLowerCase();
  const expiresAt = String((quote as any).expires_at || "").trim();
  const isExpired =
    storedStatus === "active" &&
    expiresAt &&
    !Number.isNaN(new Date(expiresAt).getTime()) &&
    Date.now() > new Date(expiresAt).getTime();
  const effectiveStatus = isExpired ? "expired" : storedStatus || "active";

  return apiJson({
    success: true,
    quote_id: (quote as any).id,
    quote_status: effectiveStatus,
    quote_expires_at: (quote as any).expires_at,
    quote: {
      quote_id: (quote as any).id,
      expires_at: (quote as any).expires_at,
      checkout_mode: hasPlan ? "recurring_plan" : "one_time_addon",
      purchase_type: hasPlan ? "subscription" : hasCapacity && hasCodes ? "mixed_addons" : hasCapacity ? "capacity_addon" : "code_topup",
      selected_plan_template_id: (quote as any).plan_id || null,
      plan_snapshot: Object.keys(planSnapshot).length
        ? {
            name: String(planSnapshot.name || "Subscription"),
            billing_cycle: String(planSnapshot.billing_cycle || "monthly") === "yearly" ? "yearly" : "monthly",
            plan_price_paise: toInt(planSnapshot.plan_price_paise),
            pricing_unit_size: toInt(planSnapshot.pricing_unit_size || 1),
            quotas: asObject(planSnapshot.quotas),
            capacities: asObject(planSnapshot.capacities),
          }
        : null,
      addons_snapshot: {
        capacity_addons: capacityAddons,
        code_addons: codeAddons,
      },
      coupon: Object.keys(couponSnapshot).length
        ? {
            id: String(couponSnapshot.id || ""),
            code: String(couponSnapshot.code || ""),
            discount_type: String(couponSnapshot.discount_type || "percentage"),
            discount_value: toInt(couponSnapshot.discount_value),
            max_discount_paise:
              couponSnapshot.max_discount_paise == null ? null : toInt(couponSnapshot.max_discount_paise),
            discount_paise: toInt(couponSnapshot.discount_paise),
          }
        : null,
      totals: {
        currency: String((quote as any).currency || totalsSnapshot.currency || "INR"),
        subscription_paise: toInt(totalsSnapshot.subscription_paise),
        capacity_addons_paise: toInt(totalsSnapshot.capacity_addons_paise),
        code_addons_paise: toInt(totalsSnapshot.code_addons_paise),
        addons_paise: toInt(totalsSnapshot.addons_paise),
        discount_paise: toInt(totalsSnapshot.discount_paise),
        taxable_subtotal_paise: toInt(totalsSnapshot.taxable_subtotal_paise),
        gst_rate_percent: toInt(totalsSnapshot.gst_rate_percent || 18),
        gst_paise: toInt(totalsSnapshot.gst_paise),
        final_total_paise: toInt(totalsSnapshot.final_total_paise),
      },
    },
  });
}

import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { resolveActiveCoupon } from "@/lib/billing/coupons";
import {
  buildCheckoutQuote,
  loadCheckoutCatalog,
  type CheckoutQuotePayload,
  type CheckoutQuoteInput,
} from "@/lib/billing/userCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const body = await req.json().catch(() => ({}));
    const planTemplateId = String((body as any)?.plan_template_id || (body as any)?.plan_id || "").trim();
    const couponCode = String((body as any)?.coupon_code || "").trim();
    const catalog = await loadCheckoutCatalog(owner.supabase);
    const coupon = couponCode ? await resolveActiveCoupon(owner.supabase, couponCode) : null;
    if (couponCode && !coupon) {
      return apiJson({ error: "INVALID_COUPON" }, { status: 400 });
    }

    const genericAddons = Array.isArray((body as any)?.addons) ? (body as any).addons : [];
    const codeAddonsFromGeneric = genericAddons
      .map((entry: any) => ({
        addon_id: String(entry?.addon_id || "").trim(),
        quantity: Math.max(0, Number(entry?.quantity || 0)),
      }))
      .filter((entry: any) => entry.addon_id && entry.quantity > 0);

    const quoteInput: CheckoutQuoteInput = {
      companyId: owner.companyId,
      ownerUserId: owner.userId,
      planTemplateId: planTemplateId || null,
      coupon,
      capacityAddons: Array.isArray((body as any)?.capacity_addons)
        ? (body as any).capacity_addons
        : Array.isArray((body as any)?.structural_addons)
        ? (body as any).structural_addons
        : [],
      codeAddons: Array.isArray((body as any)?.code_addons)
        ? (body as any).code_addons
        : codeAddonsFromGeneric.length
        ? codeAddonsFromGeneric
        : Array.isArray((body as any)?.variable_topups)
        ? (body as any).variable_topups
        : [],
    };

    const quote = buildCheckoutQuote(quoteInput, catalog);
    const quoteResponse: CheckoutQuotePayload & {
      plan_snapshot: CheckoutQuotePayload["plan"];
      addons_snapshot: {
        capacity_addons: CheckoutQuotePayload["capacity_addons"];
        code_addons: CheckoutQuotePayload["code_addons"];
      };
      discount_paise: number;
      gst_paise: number;
      final_total_paise: number;
    } = {
      ...quote,
      plan_snapshot: quote.plan,
      addons_snapshot: {
        capacity_addons: quote.capacity_addons,
        code_addons: quote.code_addons,
      },
      discount_paise: quote.totals.discount_paise,
      gst_paise: quote.totals.gst_paise,
      final_total_paise: quote.totals.final_total_paise,
    };
    const { data: persistedQuote, error: quotePersistError } = await owner.supabase
      .from("quotes")
      .insert({
        company_id: owner.companyId,
        user_id: owner.userId,
        plan_id: quote.selected_plan_template_id || null,
        coupon_id: quote.coupon?.id || null,
        coupon_code: quote.coupon?.code || null,
        coupon_snapshot_json: quote.coupon
          ? {
              id: quote.coupon.id,
              code: quote.coupon.code,
              discount_type: quote.coupon.discount_type,
              discount_value: quote.coupon.discount_value,
              max_discount_paise: quote.coupon.max_discount_paise,
              discount_paise: quote.totals.discount_paise,
            }
          : {},
        plan_snapshot_json: quote.selected_plan_template_id ? quote.plan : {},
        addons_json: {
          capacity_addons: quote.capacity_addons,
          code_addons: quote.code_addons,
        },
        totals_snapshot_json: quote.totals,
        discount_paise: quote.totals.discount_paise,
        taxable_subtotal_paise: quote.totals.taxable_subtotal_paise,
        gst_paise: quote.totals.gst_paise,
        final_total_paise: quote.totals.final_total_paise,
        currency: quote.totals.currency,
        status: "active",
        expires_at: quote.expires_at,
      })
      .select("id, status, expires_at")
      .single();
    if (quotePersistError) {
      return apiJson({ error: quotePersistError.message }, { status: 500 });
    }

    console.log("ADDONS:", {
      capacity_addons: quote.capacity_addons,
      code_addons: quote.code_addons,
    });
    console.log("DISCOUNT:", quote.totals.discount_paise);
    console.log("FINAL_TOTAL:", quote.totals.final_total_paise);
    console.log("QUOTE_ID:", (persistedQuote as any).id);
    console.log("QUOTE:", quote);
    return apiJson({
      success: true,
      quote_id: (persistedQuote as any).id,
      quote_status: String((persistedQuote as any).status || "active"),
      quote_expires_at: String((persistedQuote as any).expires_at || quote.expires_at),
      quote: quoteResponse,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to compute quote");
    if (
      message.includes("PLAN_NOT_AVAILABLE") ||
      message.includes("ADDON_NOT_AVAILABLE") ||
      message.includes("INVALID_CAPACITY_ADDON_SELECTION") ||
      message.includes("INVALID_CODE_ADDON_SELECTION") ||
      message.includes("CHECKOUT_ITEM_REQUIRED") ||
      message.includes("FINAL_TOTAL_MUST_BE_GREATER_THAN_ZERO")
    ) {
      return apiJson({ error: message }, { status: 400 });
    }
    if (message.includes("CHECKOUT_SIGNING_SECRET_MISSING")) {
      return apiJson({ error: "Checkout signing secret is not configured" }, { status: 503 });
    }
    return apiJson({ error: message }, { status: 500 });
  }
}


import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureInvoicePdfForInvoice } from "@/lib/billing/invoiceLifecycle";

type JsonRecord = Record<string, any>;

export type FinalizeQuoteParams = {
  supabase: SupabaseClient<any>;
  quoteId: string;
  expectedCompanyId?: string;
  expectedUserId?: string;
  correlationId?: string;
};

export type FinalizeQuoteResult = {
  success: true;
  no_op: boolean;
  quote_id: string;
  company_id: string;
  invoice_reference: string;
  reason?: "already_fulfilled";
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPaise(value: unknown): number {
  return Math.max(0, Math.trunc(toNumber(value, 0)));
}

function mapAddonEntitlementToResource(key: string | null | undefined): string | null {
  switch (String(key || "").toLowerCase()) {
    case "unit":
      return "unit";
    case "box":
      return "box";
    case "carton":
      return "carton";
    case "pallet":
      return "pallet";
    case "seat":
      return "seats";
    case "plant":
      return "plants";
    case "handset":
      return "handsets";
    default:
      return null;
  }
}

export async function finalizeQuoteInternal(params: FinalizeQuoteParams): Promise<FinalizeQuoteResult> {
  const { supabase, quoteId, expectedCompanyId, expectedUserId, correlationId } = params;
  const normalizedQuoteId = String(quoteId || "").trim();
  if (!normalizedQuoteId) {
    throw new Error("QUOTE_ID_REQUIRED");
  }

  const { data: quote, error: quoteError } = await supabase.from("quotes").select("*").eq("id", normalizedQuoteId).maybeSingle();
  if (quoteError) throw new Error(quoteError.message);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");

  const companyId = String((quote as any).company_id || "").trim();
  const userId = String((quote as any).user_id || "").trim();
  if (expectedCompanyId && companyId !== expectedCompanyId) throw new Error("QUOTE_FORBIDDEN");
  if (expectedUserId && userId !== expectedUserId) throw new Error("QUOTE_FORBIDDEN");

  const invoiceReference = `quote:${normalizedQuoteId}`;
  if ((quote as any).fulfilled_at) {
    return {
      success: true,
      no_op: true,
      reason: "already_fulfilled",
      quote_id: normalizedQuoteId,
      company_id: companyId,
      invoice_reference: invoiceReference,
    };
  }

  const { data: intent, error: intentError } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("quote_id", normalizedQuoteId)
    .maybeSingle();
  if (intentError) throw new Error(intentError.message);
  if (!intent) throw new Error("PAYMENT_INTENT_NOT_FOUND");
  if (String((intent as any).status || "").trim().toLowerCase() !== "paid") {
    throw new Error("PAYMENT_NOT_CAPTURED_YET");
  }

  const planSnapshot = (((quote as any).plan_snapshot_json || {}) as JsonRecord) || {};
  const totalsSnapshot = (((quote as any).totals_snapshot_json || {}) as JsonRecord) || {};
  const addonsSnapshot = (((quote as any).addons_json || {}) as JsonRecord) || {};
  const hasPlan = Object.keys(planSnapshot).length > 0;

  const finalTotalPaise = toPaise(totalsSnapshot.final_total_paise);
  if (finalTotalPaise <= 0) {
    throw new Error("QUOTE_FINAL_TOTAL_MISSING");
  }

  const nowIso = new Date().toISOString();
  const billingCycle = String(planSnapshot.billing_cycle || "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";
  const periodStartIso = nowIso;
  const periodEndDate = new Date(periodStartIso);
  periodEndDate.setUTCMonth(periodEndDate.getUTCMonth() + (billingCycle === "yearly" ? 12 : 1));
  let periodEndIso = periodEndDate.toISOString();

  if (!hasPlan) {
    const { data: activeSub } = await supabase
      .from("company_subscriptions")
      .select("current_period_end")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existingPeriodEnd = String((activeSub as any)?.current_period_end || "").trim();
    if (existingPeriodEnd) {
      periodEndIso = existingPeriodEnd;
    }
  }

  if (hasPlan) {
    const { data: existingSub, error: subReadError } = await supabase
      .from("company_subscriptions")
      .select("id, activated_at, metadata")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subReadError) throw new Error(subReadError.message);

    const subscriptionPayload = {
      company_id: companyId,
      status: "active",
      plan_template_id: (quote as any).plan_id || null,
      plan_version_id: null,
      billing_cycle: billingCycle,
      current_period_start: periodStartIso,
      current_period_end: periodEndIso,
      next_billing_at: periodEndIso,
      renewal_date: periodEndIso,
      start_date: periodStartIso,
      activated_at: (existingSub as any)?.activated_at || nowIso,
      updated_at: nowIso,
      metadata: {
        ...(((existingSub as any)?.metadata || {}) as JsonRecord),
        quote_id: normalizedQuoteId,
        payment_intent_id: (intent as any).id,
        razorpay_order_id: (intent as any).razorpay_order_id,
        razorpay_payment_id: (intent as any).razorpay_payment_id,
        finalized_by: "webhook",
        correlation_id: correlationId || null,
      },
    };

    if ((existingSub as any)?.id) {
      const { error: subUpdateError } = await supabase
        .from("company_subscriptions")
        .update(subscriptionPayload)
        .eq("id", (existingSub as any).id);
      if (subUpdateError) throw new Error(subUpdateError.message);
    } else {
      const { error: subInsertError } = await supabase.from("company_subscriptions").insert(subscriptionPayload);
      if (subInsertError) throw new Error(subInsertError.message);
    }

    await supabase.rpc("apply_cycle_reset", {
      p_company_id: companyId,
      p_new_period_start: periodStartIso,
      p_new_period_end: periodEndIso,
    });

    // Ledger-safe plan change reset: expire prior base subscription allocations instead of deleting history.
    await supabase
      .from("quota_allocations")
      .update({
        expires_at: periodStartIso,
        metadata: {
          reset_by_quote_id: normalizedQuoteId,
          reset_at: periodStartIso,
          correlation_id: correlationId || null,
        },
      })
      .eq("company_id", companyId)
      .eq("source", "subscription")
      .eq("quota_type", "base")
      .neq("source_quote_id", normalizedQuoteId)
      .gt("expires_at", periodStartIso);

    const baseQuotaRows = [
      { resource: "unit", amount: toNumber(planSnapshot?.quotas?.unit, 0) },
      { resource: "box", amount: toNumber(planSnapshot?.quotas?.box, 0) },
      { resource: "carton", amount: toNumber(planSnapshot?.quotas?.carton, 0) },
      { resource: "pallet", amount: toNumber(planSnapshot?.quotas?.pallet, 0) },
      { resource: "seats", amount: toNumber(planSnapshot?.capacities?.seat, 0) },
      { resource: "plants", amount: toNumber(planSnapshot?.capacities?.plant, 0) },
      { resource: "handsets", amount: toNumber(planSnapshot?.capacities?.handset, 0) },
    ]
      .map((row) => ({ ...row, amount: Math.max(0, Math.trunc(row.amount)) }))
      .filter((row) => row.amount > 0)
      .map((row) => ({
        company_id: companyId,
        source: "subscription",
        quota_type: "base",
        resource: row.resource,
        amount: row.amount,
        expires_at: periodEndIso,
        source_quote_id: normalizedQuoteId,
        metadata: {
          quote_id: normalizedQuoteId,
          payment_intent_id: (intent as any).id,
          period_start: periodStartIso,
          period_end: periodEndIso,
          correlation_id: correlationId || null,
        },
      }));

    if (baseQuotaRows.length) {
      const { error: baseInsertError } = await supabase
        .from("quota_allocations")
        .upsert(baseQuotaRows, { onConflict: "company_id,source_quote_id,quota_type,resource" });
      if (baseInsertError) throw new Error(baseInsertError.message);
    }
  }

  const codeAddons = Array.isArray(addonsSnapshot?.code_addons) ? addonsSnapshot.code_addons : [];
  const capacityAddons = Array.isArray(addonsSnapshot?.capacity_addons) ? addonsSnapshot.capacity_addons : [];
  const hasAddons = codeAddons.length > 0 || capacityAddons.length > 0;

  if (hasAddons) {
    const addonLineRows = [...codeAddons, ...capacityAddons]
      .map((line: any) => {
        const resource = mapAddonEntitlementToResource(line.entitlement_key);
        const amount =
          resource === "seats" || resource === "plants" || resource === "handsets"
            ? Math.max(0, Math.trunc(toNumber(line.allocated_capacity ?? line.quantity, 0)))
            : Math.max(0, Math.trunc(toNumber(line.allocated_quota ?? line.quantity, 0)));
        if (!resource || amount <= 0) return null;
        return {
          company_id: companyId,
          source: "addon",
          quota_type: resource === "seats" || resource === "plants" || resource === "handsets" ? "base" : "variable",
          resource,
          amount,
          expires_at: periodEndIso,
          source_quote_id: normalizedQuoteId,
          metadata: {
            quote_id: normalizedQuoteId,
            payment_intent_id: (intent as any).id,
            addon_id: line.addon_id || null,
            correlation_id: correlationId || null,
          },
        };
      })
      .filter(Boolean);

    const addonRowMap = new Map<string, any>();
    for (const row of addonLineRows as any[]) {
      const key = `${row.quota_type}:${row.resource}`;
      const existing = addonRowMap.get(key);
      if (!existing) {
        addonRowMap.set(key, row);
        continue;
      }
      existing.amount = Math.max(0, Math.trunc(toNumber(existing.amount, 0) + toNumber(row.amount, 0)));
    }
    const addonRows = Array.from(addonRowMap.values()).filter((row) => toNumber(row.amount, 0) > 0);

    if (addonRows.length) {
      const { error: addonInsertError } = await supabase
        .from("quota_allocations")
        .upsert(addonRows as any[], { onConflict: "company_id,source_quote_id,quota_type,resource" });
      if (addonInsertError) throw new Error(addonInsertError.message);
    }
  }

  if (capacityAddons.length) {
    const { data: existingCapacity, error: existingCapacityError } = await supabase
      .from("company_addon_subscriptions")
      .select("id")
      .eq("company_id", companyId)
      .contains("metadata", { quote_id: normalizedQuoteId })
      .limit(1);
    if (existingCapacityError) throw new Error(existingCapacityError.message);

    if (!existingCapacity || existingCapacity.length === 0) {
      const structuralRows = capacityAddons.map((line: any) => ({
        company_id: companyId,
        addon_id: line.addon_id,
        quantity: Math.max(1, Math.trunc(toNumber(line.quantity, 1))),
        status: "active",
        starts_at: periodStartIso,
        ends_at: periodEndIso,
        metadata: {
          quote_id: normalizedQuoteId,
          payment_intent_id: (intent as any).id,
          correlation_id: correlationId || null,
        },
      }));
      const { error: structuralInsertError } = await supabase.from("company_addon_subscriptions").insert(structuralRows);
      if (structuralInsertError) throw new Error(structuralInsertError.message);
    }
  }

  const invoicePayload = {
    company_id: companyId,
    invoice_type: hasPlan ? "subscription" : "addon_topup",
    status: "paid",
    reference: invoiceReference,
    plan: String(planSnapshot?.name || "Subscription"),
    amount: toPaise(totalsSnapshot?.final_total_paise) / 100,
    base_amount: toPaise(totalsSnapshot?.subscription_paise) / 100,
    addons_amount: toPaise(totalsSnapshot?.addons_paise) / 100,
    discount_amount: toPaise(totalsSnapshot?.discount_paise) / 100,
    tax_rate: 0.18,
    tax_amount: toPaise(totalsSnapshot?.gst_paise) / 100,
    billing_cycle: billingCycle,
    currency: String((quote as any).currency || "INR"),
    period_start: periodStartIso,
    period_end: periodEndIso,
    issued_at: nowIso,
    paid_at: nowIso,
    provider: "razorpay",
    provider_payment_id: String((intent as any).razorpay_payment_id || ""),
    metadata: {
      quote_id: normalizedQuoteId,
      plan_snapshot: planSnapshot,
      addons_snapshot: {
        capacity_addons: capacityAddons,
        code_addons: codeAddons,
      },
      totals_snapshot: totalsSnapshot,
      payment_intent_id: (intent as any).id,
      razorpay_order_id: (intent as any).razorpay_order_id,
      razorpay_payment_id: (intent as any).razorpay_payment_id,
      correlation_id: correlationId || null,
    },
    updated_at: nowIso,
  };

  const { data: invoiceInsertRows, error: invoiceInsertError } = await supabase
    .from("billing_invoices")
    .insert(invoicePayload)
    .select("id")
    .limit(1);
  if (invoiceInsertError) {
    const message = String(invoiceInsertError.message || "");
    if (!message.toLowerCase().includes("duplicate") && String((invoiceInsertError as any).code || "") !== "23505") {
      throw new Error(invoiceInsertError.message);
    }
  }

  const insertedInvoiceId = String((invoiceInsertRows as any)?.[0]?.id || "").trim();
  let invoiceId = insertedInvoiceId;
  if (!invoiceId) {
    const { data: existingInvoice, error: invoiceReadError } = await supabase
      .from("billing_invoices")
      .select("id")
      .eq("company_id", companyId)
      .eq("reference", invoiceReference)
      .maybeSingle();
    if (invoiceReadError) throw new Error(invoiceReadError.message);
    invoiceId = String((existingInvoice as any)?.id || "").trim();
  }

  if (invoiceId) {
    const pdfResult = await ensureInvoicePdfForInvoice({
      supabase,
      invoiceId,
    }).catch((error: any) => ({
      ok: false,
      invoice_pdf_url: null,
      generated: false,
      error: String(error?.message || "PDF_GENERATION_FAILED"),
    }));
    if (!pdfResult.ok) {
      console.error("INVOICE_PDF_GENERATION_FAILED", {
        quote_id: normalizedQuoteId,
        invoice_id: invoiceId,
        error: pdfResult.error || "UNKNOWN",
      });
    }
  }

  const { error: quoteUpdateError } = await supabase
    .from("quotes")
    .update({ fulfilled_at: nowIso, status: "used" })
    .eq("id", normalizedQuoteId)
    .is("fulfilled_at", null);
  if (quoteUpdateError) throw new Error(quoteUpdateError.message);

  return {
    success: true,
    no_op: false,
    quote_id: normalizedQuoteId,
    company_id: companyId,
    invoice_reference: invoiceReference,
  };
}

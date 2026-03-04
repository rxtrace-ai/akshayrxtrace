import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCompanyAccess } from "@/lib/auth/company";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { enforceEntitlement, refundEntitlement } from "@/lib/entitlement/enforce";
import { UsageType } from "@/lib/entitlement/usageTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PHASE-4: Full hierarchy generation (units + box/carton/pallet) uses
 * subscription-based quota (unit + SSCC), not wallet/credit.
 */
export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  try {
    const supabase = getSupabaseAdmin();
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      company_id: requestedCompanyId,
      sku_id,
      packing_rule_id,
      total_strips,
      request_id,
      strip_codes,
      compliance_ack,
    } = body;
    const company_id = authCompanyId;

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!sku_id || !packing_rule_id || !total_strips) {
      return NextResponse.json(
        { error: "missing required param" },
        { status: 400 }
      );
    }

    if (compliance_ack !== true) {
      return NextResponse.json(
        { error: "compliance_ack=true is required", code: "compliance_required" },
        { status: 400 }
      );
    }

    // Option A eligibility (Phase 3+): SSCC allowed only if company has at least one SKU with a GTIN.
    const { data: anySku } = await supabase
      .from("skus")
      .select("id")
      .eq("company_id", company_id)
      .not("gtin", "is", null)
      .limit(1);

    const hasGs1LikeGtin = Array.isArray(anySku) && anySku.length > 0;

    if (!hasGs1LikeGtin) {
      return NextResponse.json(
        {
          error:
            "SSCC generation is enabled only for GS1-mode companies (GTIN required).",
          code: "gs1_required",
        },
        { status: 403 }
      );
    }

    // PHASE-4: Require authenticated user with access to this company
    const { authorized, error: authErr } = await verifyCompanyAccess(
      company_id
    );
    if (authErr) return authErr;
    if (!authorized) {
      return NextResponse.json(
        { error: "Company not found or access denied" },
        { status: 403 }
      );
    }

    // 1) Fetch packing rule to compute totals (same math as preview)
    const { data: rule, error: ruleErr } = await supabase
      .from("packing_rules")
      .select("strips_per_box, boxes_per_carton, cartons_per_pallet")
      .eq("id", packing_rule_id)
      .single();

    if (ruleErr || !rule) {
      return NextResponse.json(
        { error: "packing rule not found" },
        { status: 400 }
      );
    }

    const stripsPerBox = Number(rule.strips_per_box);
    const boxesPerCarton = Number(rule.boxes_per_carton);
    const cartonsPerPallet = Number(rule.cartons_per_pallet);

    const totalBoxes = Math.ceil(Number(total_strips) / stripsPerBox);
    const totalCartons = Math.ceil(totalBoxes / boxesPerCarton);
    const totalPallets = Math.ceil(totalCartons / cartonsPerPallet);
    const totalUnits = Number(total_strips);
    const totalSSCC = totalBoxes + totalCartons + totalPallets;

    const unitDecision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.UNIT_LABEL,
      quantity: totalUnits,
      metadata: { source: "generate_hierarchy_unit" },
    });
    if (!unitDecision.allow) {
      return NextResponse.json(
        {
          error: unitDecision.reason_code,
          remaining: unitDecision.remaining,
        },
        { status: 403 }
      );
    }

    const ssccDecision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.SSCC_LABEL,
      quantity: totalSSCC,
      metadata: { source: "generate_hierarchy_sscc" },
    });
    if (!ssccDecision.allow) {
      await refundEntitlement({
        companyId: company_id,
        usageType: UsageType.UNIT_LABEL,
        quantity: totalUnits,
      });
      return NextResponse.json(
        {
          error: ssccDecision.reason_code,
          remaining: ssccDecision.remaining,
        },
        { status: 403 }
      );
    }

    try {
      const { data, error } = await supabase.rpc("create_full_hierarchy", {
        p_company_id: company_id,
        p_sku_id: sku_id,
        p_packing_rule_id: packing_rule_id,
        p_total_strips: totalUnits,
        p_request_id: request_id ?? null,
        p_strip_codes: strip_codes ?? null,
      });

      if (error) {
        await Promise.all([
          refundEntitlement({
            companyId: company_id,
            usageType: UsageType.UNIT_LABEL,
            quantity: totalUnits,
          }),
          refundEntitlement({
            companyId: company_id,
            usageType: UsageType.SSCC_LABEL,
            quantity: totalSSCC,
          }),
        ]);
        return NextResponse.json(
          { error: "Generation failed", detail: error },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, generation: data });
    } catch (genErr) {
      await Promise.all([
        refundEntitlement({
          companyId: company_id,
          usageType: UsageType.UNIT_LABEL,
          quantity: totalUnits,
        }),
        refundEntitlement({
          companyId: company_id,
          usageType: UsageType.SSCC_LABEL,
          quantity: totalSSCC,
        }),
      ]);
      return NextResponse.json(
        { error: String(genErr) },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

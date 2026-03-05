import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { enforceEntitlement, refundEntitlement } from "@/lib/entitlement/enforce";
import { UsageType } from "@/lib/entitlement/usageTypes";
import { getRequestIdFromRequest } from "@/lib/http/requestId";

export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  const authCompanyId = await resolveCompanyIdFromRequest(req);
  if (!authCompanyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const body = await req.json();
  const { sku_id, packing_rule_id, company_id: requestedCompanyId, pallet_count } = body;
  const company_id = authCompanyId;
  const requestId =
    typeof (body as any)?.request_id === "string" && String((body as any).request_id).trim()
      ? `sscc_create:body:${String((body as any).request_id).trim()}`
      : getRequestIdFromRequest(req, "sscc_create");

  if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!sku_id) {
    return NextResponse.json({ error: "sku_id is required" }, { status: 400 });
  }

  const countRaw = Number(pallet_count);
  const count = Number.isFinite(countRaw) ? Math.trunc(countRaw) : 0;
  if (!Number.isInteger(count) || count <= 0) {
    return NextResponse.json({ error: "pallet_count must be a positive integer" }, { status: 400 });
  }

  // sku_id can be either SKU master UUID or a human-readable sku_code from CSV.
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    );

  let skuUuid = sku_id as string;
  if (!isUuid(skuUuid)) {
    const skuCode = String(skuUuid).trim().toUpperCase();

    // Resolve if exists
    const { data: skuRow, error: skuErr } = await supabase
      .from("skus")
      .select("id")
      .eq("company_id", company_id)
      .eq("sku_code", skuCode)
      .maybeSingle();

    if (skuErr) {
      return NextResponse.json(
        { error: skuErr.message ?? "Failed to resolve SKU" },
        { status: 400 }
      );
    }

    // If missing, create it (so CSV usage populates SKU Master)
    if (!skuRow?.id) {
      const { data: created, error: createErr } = await supabase
        .from("skus")
        .upsert(
          { company_id, sku_code: skuCode, sku_name: null, deleted_at: null },
          { onConflict: "company_id,sku_code" }
        )
        .select("id")
        .single();

      if (createErr || !created?.id) {
        return NextResponse.json(
          { error: createErr?.message ?? `Failed to create SKU in SKU master: ${skuCode}` },
          { status: 400 }
        );
      }

      skuUuid = created.id;
    } else {
      skuUuid = skuRow.id;
    }
  }

  // 1) Get packing rule
  const ruleQuery = supabase.from("packing_rules").select("*");
  const { data: rule, error: ruleErr } = packing_rule_id
    ? await ruleQuery.eq("id", packing_rule_id).single()
    : await ruleQuery
        .eq("company_id", company_id)
        .eq("sku_id", skuUuid)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (ruleErr || !rule) {
    return NextResponse.json(
      { error: "Packing rule not found for selected SKU" },
      { status: 400 }
    );
  }

  const prefix = rule.sscc_company_prefix;
  const ext = rule.sscc_extension_digit;

  // 2) Reserve serial numbers (atomic allocator)
  const { data: alloc } = await supabase.rpc("allocate_sscc_serials", {
    p_sequence_key: prefix,
    p_count: count,
  });

  const firstSerial = alloc;

  // 3) Generate all SSCCs using serials
  const ssccList = [];
  for (let i = 0; i < count; i++) {
    const serial = firstSerial + i;

    const { data: ssccGen } = await supabase.rpc("make_sscc", {
      p_extension_digit: ext,
      p_company_prefix: prefix,
      p_serial: serial,
    });

    ssccList.push(ssccGen);
  }

  // 4) Insert pallets
  const rows = ssccList.map((sscc) => ({
    company_id,
    sku_id: skuUuid,
    packing_rule_id: rule.id,
    sscc,
    sscc_with_ai: `(00)${sscc}`,
  }));

  const decision = await enforceEntitlement({
    companyId: company_id,
    usageType: UsageType.PALLET_LABEL,
    quantity: count,
    requestId,
    metadata: { source: "sscc_create" },
  });
  if (!decision.allow) {
    return NextResponse.json(
      {
        error: decision.reason_code,
        remaining: decision.remaining,
      },
      { status: 403 }
    );
  }

  const { data: inserted, error } = await supabase
    .from("pallets")
    .insert(rows)
    .select();

  if (error) {
    await refundEntitlement({
      companyId: company_id,
      usageType: UsageType.PALLET_LABEL,
      quantity: count,
    });
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ pallets: inserted });
}

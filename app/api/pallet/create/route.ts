import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { enforceEntitlement, refundEntitlement } from "@/lib/entitlement/enforce";
import { UsageType } from "@/lib/entitlement/usageTypes";
import { getRequestIdFromRequest } from "@/lib/http/requestId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_CODES_PER_REQUEST = 10000;
const MAX_CODES_PER_ROW = 1000;

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

async function resolveSkuId(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  skuIdOrCode: string;
}): Promise<string> {
  const { supabase, companyId, skuIdOrCode } = opts;
  const raw = String(skuIdOrCode || "").trim();
  if (!raw) throw new Error("sku_id is required");

  if (isUuid(raw)) return raw;

  const skuCode = raw.toUpperCase();
  const { data: skuRow, error: skuErr } = await supabase
    .from("skus")
    .select("id")
    .eq("company_id", companyId)
    .eq("sku_code", skuCode)
    .maybeSingle();

  if (skuErr) throw new Error(skuErr.message ?? "Failed to resolve SKU");

  if (!skuRow?.id) {
    const { data: created, error: createErr } = await supabase
      .from("skus")
      .upsert(
        { company_id: companyId, sku_code: skuCode, sku_name: null, deleted_at: null },
        { onConflict: "company_id,sku_code" }
      )
      .select("id")
      .single();

    if (createErr || !created?.id) {
      throw new Error(createErr?.message ?? `Failed to create SKU in master: ${skuCode}`);
    }

    return created.id;
  }

  return skuRow.id;
}

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
      pallet_count,
      quantity,
      assign_cartons = true,
    } = body ?? {};
    const requestId =
      typeof (body as any)?.request_id === "string" && String((body as any).request_id).trim()
        ? `pallet_create:body:${String((body as any).request_id).trim()}`
        : getRequestIdFromRequest(req, "pallet_create");

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const company_id = authCompanyId;

    const skuUuid = await resolveSkuId({
      supabase,
      companyId: company_id,
      skuIdOrCode: sku_id,
    });

    const countRaw = Number(pallet_count ?? quantity);
    const count = Number.isFinite(countRaw) ? Math.trunc(countRaw) : 0;
    if (!Number.isInteger(count) || count <= 0) {
      return NextResponse.json({ error: "pallet_count/quantity must be a positive integer" }, { status: 400 });
    }
    if (count > MAX_CODES_PER_ROW) {
      return NextResponse.json(
        {
          error: `Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`,
          code: "limit_exceeded",
          requested: count,
          max_per_row: MAX_CODES_PER_ROW,
          max_per_request: MAX_CODES_PER_REQUEST,
        },
        { status: 400 }
      );
    }

    // 1) Get packing rule (required to know cartons per pallet)
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

    const cartonsPerPallet = Math.max(1, Number(rule.cartons_per_pallet) || 1);
    const allowPartial =
      rule.allow_partial_last_container === undefined
        ? true
        : !!rule.allow_partial_last_container;

    // 2) Optionally reserve cartons to link
    const totalCartonsNeeded = cartonsPerPallet * count;
    let cartonIds: string[] = [];

    if (assign_cartons) {
      const { data: cartons, error: cartonsErr } = await supabase
        .from("cartons")
        .select("id")
        .eq("company_id", company_id)
        .eq("sku_id", skuUuid)
        .is("pallet_id", null)
        .order("created_at", { ascending: true })
        .limit(totalCartonsNeeded);

      if (cartonsErr) {
        return NextResponse.json(
          { error: cartonsErr.message ?? "Failed to fetch unassigned cartons" },
          { status: 400 }
        );
      }

      cartonIds = (cartons ?? []).map((c: any) => c.id).filter(Boolean);
      if (!allowPartial && cartonIds.length < totalCartonsNeeded) {
        return NextResponse.json(
          {
            error: `Not enough unassigned cartons to fill ${count} pallets (${totalCartonsNeeded} cartons required, ${cartonIds.length} available).`,
          },
          { status: 400 }
        );
      }
    }

    // 3) Reserve SSCC serials and generate SSCCs
    const prefix = rule.sscc_company_prefix;
    const ext = rule.sscc_extension_digit;

    const { data: alloc, error: allocErr } = await supabase.rpc(
      "allocate_sscc_serials",
      {
        p_sequence_key: prefix,
        p_count: count,
      }
    );

    if (allocErr) {
      return NextResponse.json(
        { error: allocErr.message ?? "Failed to allocate SSCC serials" },
        { status: 400 }
      );
    }

    const firstSerial = alloc as any;
    const ssccList: string[] = [];
    for (let i = 0; i < count; i++) {
      const serial = Number(firstSerial) + i;
      const { data: ssccGen, error: ssccErr } = await supabase.rpc("make_sscc", {
        p_extension_digit: ext,
        p_company_prefix: prefix,
        p_serial: serial,
      });

      if (ssccErr || !ssccGen) {
        return NextResponse.json(
          { error: ssccErr?.message ?? "Failed to generate SSCC" },
          { status: 400 }
        );
      }

      ssccList.push(ssccGen as any);
    }

    // 4) Insert pallets
    const nowIso = new Date().toISOString();
    const rows = ssccList.map((sscc, idx) => {
      const assignedCount = assign_cartons
        ? Math.min(cartonsPerPallet, Math.max(0, cartonIds.length - idx * cartonsPerPallet))
        : 0;

      return {
        company_id,
        sku_id: skuUuid,
        packing_rule_id: rule.id,
        sscc,
        sscc_with_ai: `(00)${sscc}`,
        meta: {
          created_at: nowIso,
          pallet_number: idx + 1,
          cartons_per_pallet: cartonsPerPallet,
          cartons_assigned: assignedCount,
          packing_rule_id: rule.id,
        },
      };
    });

    const decision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.PALLET_LABEL,
      quantity: count,
      requestId,
      metadata: { source: "pallet_create" },
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

    const { data: inserted, error: insertErr } = await supabase
      .from("pallets")
      .insert(rows)
      .select("id, sscc, sscc_with_ai, sku_id, created_at, meta");

    if (insertErr || !inserted) {
      await refundEntitlement({
        companyId: company_id,
        usageType: UsageType.PALLET_LABEL,
        quantity: count,
      });
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to insert pallets" },
        { status: 400 }
      );
    }

    // 5) Link cartons -> pallets (cartons.pallet_id)
    let linkedCartons = 0;
    if (assign_cartons && cartonIds.length > 0) {
      for (let i = 0; i < inserted.length; i++) {
        const pallet = inserted[i] as any;
        const chunk = cartonIds.slice(i * cartonsPerPallet, (i + 1) * cartonsPerPallet);
        if (chunk.length === 0) break;

        const { data: updatedRows, error: updErr } = await supabase
          .from("cartons")
          .update({ pallet_id: pallet.id })
          .in("id", chunk)
          .is("pallet_id", null)
          .select("id");

        if (updErr) {
          return NextResponse.json(
            {
              error:
                updErr.message ??
                "Pallets created but failed to link cartons (partial state)",
              pallets: inserted,
            },
            { status: 500 }
          );
        }

        const updatedCount = Array.isArray(updatedRows)
          ? (updatedRows as any[]).length
          : 0;
        linkedCartons += updatedCount;

        if (!allowPartial && updatedCount < chunk.length) {
          return NextResponse.json(
            {
              error:
                `Not enough unassigned cartons to fill ${count} pallets (race/shortage while linking). ` +
                `Needed ${totalCartonsNeeded}, attempted ${cartonIds.length}, linked ${linkedCartons}.`,
              pallets: inserted,
              cartons_per_pallet: cartonsPerPallet,
              cartons_linked: linkedCartons,
              requested_pallets: count,
              sku_id: skuUuid,
            },
            { status: 400 }
          );
        }

        // Keep the denormalized boxes.pallet_id in sync for all boxes in these cartons.
        // Only set when currently NULL to avoid overwriting another aggregation.
        await supabase
          .from("boxes")
          .update({ pallet_id: pallet.id })
          .in("carton_id", chunk)
          .is("pallet_id", null);
      }
    }

    return NextResponse.json({
      pallets: inserted,
      cartons_per_pallet: cartonsPerPallet,
      cartons_reserved: cartonIds.length,
      cartons_linked: linkedCartons,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

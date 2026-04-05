import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDigits(input: string) {
  return input.replace(/[^0-9]/g, "");
}

function escapeCsvValue(value: unknown) {
  const normalized =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);

  return `"${normalized.replace(/"/g, '""')}"`;
}

function escapeSpreadsheetText(value: unknown) {
  const normalized =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);

  return `="${normalized.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await (await supabaseServer()).auth.getUser();

  if (!user || authError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(supabase, user.id, "id");
  if (!resolved?.companyId) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const companyId = resolved.companyId;
  const { searchParams } = new URL(req.url);
  const batchId = String(searchParams.get("batch_id") || "").trim();

  if (batchId) {
    const { data: batch, error: batchError } = await supabase
      .from("code_generation_batches")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", batchId)
      .maybeSingle();

    if (batchError) {
      return NextResponse.json({ error: batchError.message }, { status: 500 });
    }
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (batch.generation_family === "UNIT") {
      const { data: items, error } = await supabase
        .from("labels_units")
        .select("serial, payload, gs1_payload, code_mode, gtin, batch, expiry, created_at")
        .eq("company_id", companyId)
        .eq("generation_batch_id", batchId)
        .order("created_at", { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const csv = [
        "Batch No,Generated At,SKU Code,GTIN,Product Batch,Code Family,Code Mode,Symbol Type,Serial,Payload,GTIN From Code,Expiry",
        ...(items || []).map((item) =>
          [
            escapeCsvValue(batch.batch_no),
            escapeCsvValue(item.created_at),
            escapeCsvValue(batch.sku_code_snapshot),
            escapeCsvValue(batch.gtin_snapshot),
            escapeCsvValue(batch.product_batch_snapshot),
            escapeCsvValue(batch.generation_family),
            escapeCsvValue(item.code_mode),
            escapeCsvValue(batch.symbol_type),
            escapeCsvValue(item.serial),
            escapeCsvValue(item.payload ?? item.gs1_payload),
            escapeCsvValue(item.gtin),
            escapeCsvValue(item.expiry),
          ].join(",")
        ),
      ].join("\n");

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=${batch.batch_no}_codes.csv`,
        },
      });
    }

    const [boxesResult, cartonsResult, palletsResult] = await Promise.all([
      supabase
        .from("boxes")
        .select("id, sscc, sscc_with_ai, created_at")
        .eq("company_id", companyId)
        .eq("generation_batch_id", batchId)
        .order("created_at", { ascending: true }),
      supabase
        .from("cartons")
        .select("id, sscc, sscc_with_ai, created_at")
        .eq("company_id", companyId)
        .eq("generation_batch_id", batchId)
        .order("created_at", { ascending: true }),
      supabase
        .from("pallets")
        .select("id, sscc, sscc_with_ai, created_at")
        .eq("company_id", companyId)
        .eq("generation_batch_id", batchId)
        .order("created_at", { ascending: true }),
    ]);

    if (boxesResult.error || cartonsResult.error || palletsResult.error) {
      return NextResponse.json(
        { error: boxesResult.error?.message || cartonsResult.error?.message || palletsResult.error?.message || "Export failed" },
        { status: 500 }
      );
    }

    const rows = [
      ...((boxesResult.data || []).map((item) => ({ ...item, level: "BOX" }))),
      ...((cartonsResult.data || []).map((item) => ({ ...item, level: "CARTON" }))),
      ...((palletsResult.data || []).map((item) => ({ ...item, level: "PALLET" }))),
    ];

    const csv = [
      "Batch No,Generated At,SKU Code,GTIN,Product Batch,Code Family,Code Mode,Symbol Type,Level,SSCC,SSCC With AI",
      ...rows.map((item) =>
        [
          escapeCsvValue(batch.batch_no),
          escapeCsvValue(item.created_at),
          escapeCsvValue(batch.sku_code_snapshot),
          escapeCsvValue(batch.gtin_snapshot),
          escapeCsvValue(batch.product_batch_snapshot),
          escapeCsvValue(batch.generation_family),
          escapeCsvValue(batch.code_mode),
          escapeCsvValue(batch.symbol_type),
          escapeCsvValue(item.level),
          escapeSpreadsheetText(item.sscc),
          escapeSpreadsheetText(item.sscc_with_ai),
        ].join(",")
      ),
    ].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=${batch.batch_no}_codes.csv`,
      },
    });
  }

  let query = supabase
    .from("code_generation_batches")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  const generationFamily = String(searchParams.get("generation_family") || "").trim();
  const status = String(searchParams.get("status") || "").trim();
  const source = String(searchParams.get("source") || "").trim();
  const skuCode = String(searchParams.get("sku_code") || "").trim();
  const gtin = normalizeDigits(String(searchParams.get("gtin") || "").trim());
  const productBatch = String(searchParams.get("product_batch") || "").trim();
  const from = String(searchParams.get("from") || "").trim();
  const to = String(searchParams.get("to") || "").trim();

  if (generationFamily) query = query.eq("generation_family", generationFamily);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (skuCode) query = query.ilike("sku_code_snapshot", `%${skuCode}%`);
  if (gtin) {
    const { data: matchingUnitMasters, error: unitMasterError } = await supabase
      .from("unit_sku_master")
      .select("id")
      .eq("company_id", companyId)
      .ilike("gtin", `%${gtin}%`)
      .is("deleted_at", null);

    if (unitMasterError) {
      return NextResponse.json({ error: unitMasterError.message }, { status: 500 });
    }

    const unitMasterIds = (matchingUnitMasters || [])
      .map((row) => String(row.id || "").trim())
      .filter(Boolean);

    if (unitMasterIds.length > 0) {
      query = query.or(`gtin_snapshot.ilike.%${gtin}%,unit_sku_master_id.in.(${unitMasterIds.join(",")})`);
    } else {
      query = query.ilike("gtin_snapshot", `%${gtin}%`);
    }
  }
  if (productBatch) query = query.ilike("product_batch_snapshot", `%${productBatch}%`);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const csv = [
    "Batch No,Date,Source,SKU Code,GTIN,Product Batch,Code Family,Code Mode,Symbol Type,Requested Qty,Generated Qty,Failed Qty,Status",
    ...(data || []).map((row) =>
      [
        escapeCsvValue(row.batch_no),
        escapeCsvValue(row.created_at),
        escapeCsvValue(row.source),
        escapeCsvValue(row.sku_code_snapshot),
        escapeCsvValue(row.gtin_snapshot),
        escapeCsvValue(row.product_batch_snapshot),
        escapeCsvValue(row.generation_family),
        escapeCsvValue(row.code_mode),
        escapeCsvValue(row.symbol_type),
        escapeCsvValue(row.requested_qty),
        escapeCsvValue(row.generated_qty),
        escapeCsvValue(row.failed_qty),
        escapeCsvValue(row.status),
      ].join(",")
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=code_generation_batches.csv",
    },
  });
}

import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { validateUnitSkuMasterInput } from "@/lib/unitSkuMaster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSkuCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeText(value: unknown) {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

async function requireCompanyId() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) {
    return { error: apiJson({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: company, error } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (error || !company?.id) {
    return { error: apiJson({ error: "Company profile not found" }, { status: 400 }) };
  }

  return { companyId: company.id };
}

function applyNullableMatch<T extends { eq: Function; is: Function }>(
  query: T,
  column: string,
  value: string | null
) {
  return value == null ? query.is(column, null) : query.eq(column, value);
}

export async function POST(req: Request) {
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");

  const body = await req.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (rows.length === 0) {
    return apiJson({ error: "No rows provided" }, { status: 400 });
  }

  if (rows.length > 5000) {
    return apiJson({ error: "Too many rows (max 5000)" }, { status: 400 });
  }

  if (scope === "unit_master") {
    const results = {
      total: rows.length,
      inserted: 0,
      duplicates: 0,
      invalid: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    const validRows: Array<{
      company_id: string;
      sku_code: string;
      gtin: string | null;
      batch: string;
      expiry: string;
      mfd: string | null;
      mrp: string | null;
    }> = [];
    const seenKeys = new Set<string>();

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] as Record<string, unknown>;
      const rowNum = index + 2;
      const validated = await validateUnitSkuMasterInput({
        sku_code: row.sku_code ?? row.SKU_CODE ?? row.sku ?? row.SKU,
        gtin: row.gtin ?? row.GTIN,
        batch: row.batch ?? row.BATCH ?? row.batch_number ?? row.BATCH_NUMBER,
        expiry: row.expiry ?? row.EXPIRY ?? row.expiry_date ?? row.EXPIRY_DATE,
        mfd: row.mfd ?? row.MFD ?? row.manufacturing_date ?? row.MANUFACTURING_DATE,
        mrp: row.mrp ?? row.MRP,
      });

      if (!validated.ok) {
        results.invalid++;
        results.errors.push({ row: rowNum, error: validated.error });
        continue;
      }

      const duplicateKey = [
        validated.value.sku_code.toLowerCase(),
        validated.value.batch.toLowerCase(),
        validated.value.expiry,
        validated.value.mfd || "",
        validated.value.mrp || "",
      ].join("|");

      if (seenKeys.has(duplicateKey)) {
        results.duplicates++;
        results.errors.push({
          row: rowNum,
          error: "Duplicate CSV row with same sku_code, batch, expiry, mfd, and mrp",
        });
        continue;
      }

      let existingQuery = supabaseAdmin
        .from("unit_sku_master")
        .select("id")
        .eq("company_id", auth.companyId)
        .eq("sku_code", validated.value.sku_code)
        .eq("batch", validated.value.batch)
        .eq("expiry", validated.value.expiry)
        .is("deleted_at", null);

      existingQuery = applyNullableMatch(existingQuery, "mfd", validated.value.mfd);
      existingQuery = applyNullableMatch(existingQuery, "mrp", validated.value.mrp);

      const existing = await existingQuery.maybeSingle();

      if (existing.error) {
        results.invalid++;
        results.errors.push({ row: rowNum, error: existing.error.message });
        continue;
      }

      if (existing.data?.id) {
        results.duplicates++;
        results.errors.push({
          row: rowNum,
          error: "Duplicate existing SKU Master record. GTIN does not create a new record.",
        });
        continue;
      }

      seenKeys.add(duplicateKey);
      validRows.push({
        company_id: auth.companyId,
        ...validated.value,
      });
    }

    if (validRows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("unit_sku_master")
        .insert(validRows)
        .select("id");

      if (error) {
        return apiJson({ error: error.message, results }, { status: 400 });
      }

      results.inserted = (data ?? []).length;
    }

    return apiJson({ results });
  }

  const payload = rows
    .map((r: any) => {
      const sku_code = normalizeSkuCode(r.sku_code ?? r.SKU_CODE);
      const sku_name = normalizeText(r.sku_name ?? r.SKU_NAME);
      if (!sku_code || !sku_name) return null;
      return {
        company_id: auth.companyId,
        sku_code,
        sku_name,
      };
    })
    .filter(Boolean) as Array<any>;

  if (payload.length === 0) {
    return apiJson({ error: "No valid rows (need sku_code and sku_name)" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("skus")
    .upsert(payload, { onConflict: "company_id,sku_code", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return apiJson({ error: error.message }, { status: 400 });
  }

  const imported = (data ?? []).length;
  const skipped = rows.length - imported;

  return apiJson({ imported, skipped });
}


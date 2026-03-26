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

  return { companyId: company.id, userId: user.id };
}

function applyNullableMatch<T extends { eq: Function; is: Function }>(
  query: T,
  column: string,
  value: string | null
) {
  return value == null ? query.is(column, null) : query.eq(column, value);
}

export async function GET(req: Request) {
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");

  if (scope === "unit_master") {
    let query = supabaseAdmin
      .from("unit_sku_master")
      .select("id, company_id, sku_code, gtin, batch, expiry, mfd, mrp, created_at, deleted_at")
      .eq("company_id", auth.companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (url.searchParams.get("gtin_only") === "true") {
      query = query.not("gtin", "is", null).neq("gtin", "");
    }

    const { data, error } = await query;

    if (error) {
      return apiJson({ error: error.message }, { status: 400 });
    }

    return apiJson({ company_id: auth.companyId, items: data ?? [] });
  }

  const { data, error } = await supabaseAdmin
    .from("skus")
    .select("id, company_id, sku_code, sku_name, gtin, created_at, updated_at")
    .eq("company_id", auth.companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return apiJson({ error: error.message }, { status: 400 });
  }

  return apiJson({ company_id: auth.companyId, skus: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");

  const body = await req.json();

  if (scope === "unit_master") {
    const validated = await validateUnitSkuMasterInput(body);
    if (!validated.ok) {
      return apiJson({ error: validated.error }, { status: 400 });
    }

    let duplicateQuery = supabaseAdmin
      .from("unit_sku_master")
      .select("id")
      .eq("company_id", auth.companyId)
      .eq("sku_code", validated.value.sku_code)
      .eq("batch", validated.value.batch)
      .eq("expiry", validated.value.expiry)
      .is("deleted_at", null);

    duplicateQuery = applyNullableMatch(duplicateQuery, "mfd", validated.value.mfd);
    duplicateQuery = applyNullableMatch(duplicateQuery, "mrp", validated.value.mrp);

    const duplicate = await duplicateQuery.maybeSingle();

    if (duplicate.error) {
      return apiJson({ error: duplicate.error.message }, { status: 400 });
    }

    if (duplicate.data?.id) {
      return apiJson(
        {
          error:
            "Duplicate SKU Master record. A record with the same sku_code, batch, expiry, mfd, and mrp already exists. GTIN does not create a new record.",
          code: "DUPLICATE_SKU_MASTER",
        },
        { status: 409 }
      );
    }

    const { data: insertedUnitMaster, error: insertUnitMasterError } = await supabaseAdmin
      .from("unit_sku_master")
      .insert({
        company_id: auth.companyId,
        ...validated.value,
      })
      .select("id, company_id, sku_code, gtin, batch, expiry, mfd, mrp, created_at, deleted_at")
      .single();

    if (insertUnitMasterError) {
      const message =
        insertUnitMasterError.code === "23505"
          ? "Duplicate SKU Master record. A record with the same business data already exists."
          : insertUnitMasterError.message;
      return apiJson({ error: message }, { status: insertUnitMasterError.code === "23505" ? 409 : 400 });
    }

    return apiJson({ item: insertedUnitMaster });
  }

  const sku_code = normalizeSkuCode(body.sku_code);
  const sku_name = normalizeText(body.sku_name);

  if (!sku_code || !sku_name) {
    return apiJson(
      { error: "sku_code and sku_name are required" },
      { status: 400 }
    );
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("skus")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("sku_code", sku_code)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingErr) {
    return apiJson({ error: existingErr.message }, { status: 400 });
  }

  if (existing?.id) {
    return apiJson(
      { error: `SKU code already exists: ${sku_code}` },
      { status: 409 }
    );
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("skus")
    .insert({
      company_id: auth.companyId,
      sku_code,
      sku_name,
    })
    .select("id, company_id, sku_code, sku_name, created_at, updated_at")
    .single();

  if (error) {
    return apiJson({ error: error.message }, { status: 400 });
  }

  return apiJson({ sku: inserted });
}


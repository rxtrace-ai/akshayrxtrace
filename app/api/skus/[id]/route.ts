import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();

  const body = await req.json();
  const sku_code = normalizeSkuCode(body.sku_code);
  const sku_name = normalizeText(body.sku_name);

  if (!sku_code || !sku_name) {
    return apiJson(
      { error: "sku_code and sku_name are required" },
      { status: 400 }
    );
  }

  const { data: existingSku, error: fetchErr } = await supabaseAdmin
    .from("skus")
    .select("id")
    .eq("id", params.id)
    .eq("company_id", auth.companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr) {
    return apiJson({ error: fetchErr.message }, { status: 400 });
  }

  if (!existingSku?.id) {
    return apiJson({ error: "SKU not found" }, { status: 404 });
  }

  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("skus")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("sku_code", sku_code)
    .is("deleted_at", null)
    .neq("id", params.id)
    .maybeSingle();

  if (dupErr) {
    return apiJson({ error: dupErr.message }, { status: 400 });
  }

  if (dup?.id) {
    return apiJson(
      { error: `SKU code already exists: ${sku_code}` },
      { status: 409 }
    );
  }

  const { data: updated, error } = await supabaseAdmin
    .from("skus")
    .update({
      sku_code,
      sku_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("company_id", auth.companyId)
    .select("id, company_id, sku_code, sku_name, created_at, updated_at")
    .single();

  if (error) {
    return apiJson({ error: error.message }, { status: 400 });
  }

  return apiJson({ sku: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();

  const { data: sku, error: fetchErr } = await supabaseAdmin
    .from("skus")
    .select("id")
    .eq("id", params.id)
    .eq("company_id", auth.companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr) {
    return apiJson({ error: fetchErr.message }, { status: 400 });
  }

  if (!sku?.id) {
    return apiJson({ error: "SKU not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("skus")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("company_id", auth.companyId);

  if (error) {
    return apiJson({ error: error.message }, { status: 400 });
  }

  return apiJson({ success: true });
}

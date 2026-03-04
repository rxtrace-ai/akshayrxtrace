import { NextResponse } from "next/server";
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
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: company, error } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (error || !company?.id) {
    return { error: NextResponse.json({ error: "Company profile not found" }, { status: 400 }) };
  }

  return { companyId: company.id, userId: user.id };
}

export async function GET() {
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("skus")
    .select("id, company_id, sku_code, sku_name, gtin, created_at, updated_at")
    .eq("company_id", auth.companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ company_id: auth.companyId, skus: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireCompanyId();
  if ("error" in auth) return auth.error;

  const supabaseAdmin = getSupabaseAdmin();

  const body = await req.json();
  const sku_code = normalizeSkuCode(body.sku_code);
  const sku_name = normalizeText(body.sku_name);

  if (!sku_code || !sku_name) {
    return NextResponse.json(
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
    return NextResponse.json({ error: existingErr.message }, { status: 400 });
  }

  if (existing?.id) {
    return NextResponse.json(
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ sku: inserted });
}

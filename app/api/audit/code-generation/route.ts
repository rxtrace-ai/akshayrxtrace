import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const { searchParams } = new URL(req.url);
  const companyId = resolved.companyId;
  const page = Math.max(1, Number.parseInt(String(searchParams.get("page") || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(searchParams.get("page_size") || "25"), 10) || 25));
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  let query = supabase
    .from("code_generation_batches")
    .select("*", { count: "exact" })
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .range(fromIndex, toIndex);

  const generationFamily = String(searchParams.get("generation_family") || "").trim();
  const status = String(searchParams.get("status") || "").trim();
  const source = String(searchParams.get("source") || "").trim();
  const skuCode = String(searchParams.get("sku_code") || "").trim();
  const gtin = String(searchParams.get("gtin") || "").trim();
  const productBatch = String(searchParams.get("product_batch") || "").trim();
  const from = String(searchParams.get("from") || "").trim();
  const to = String(searchParams.get("to") || "").trim();

  if (generationFamily) query = query.eq("generation_family", generationFamily);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (skuCode) query = query.ilike("sku_code_snapshot", `%${skuCode}%`);
  if (gtin) query = query.ilike("gtin_snapshot", `%${gtin}%`);
  if (productBatch) query = query.ilike("product_batch_snapshot", `%${productBatch}%`);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data || [],
    total: count || 0,
    page,
    page_size: pageSize,
  });
}

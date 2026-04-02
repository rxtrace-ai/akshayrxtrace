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

  let query = supabase
    .from("code_generation_batches")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  const generationFamily = String(searchParams.get("generation_family") || "").trim();
  const status = String(searchParams.get("status") || "").trim();
  const source = String(searchParams.get("source") || "").trim();
  const skuCode = String(searchParams.get("sku_code") || "").trim();
  const productBatch = String(searchParams.get("product_batch") || "").trim();
  const batchNo = String(searchParams.get("batch_no") || "").trim();
  const from = String(searchParams.get("from") || "").trim();
  const to = String(searchParams.get("to") || "").trim();

  if (generationFamily) query = query.eq("generation_family", generationFamily);
  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (skuCode) query = query.ilike("sku_code_snapshot", `%${skuCode}%`);
  if (productBatch) query = query.ilike("product_batch_snapshot", `%${productBatch}%`);
  if (batchNo) query = query.ilike("batch_no", `%${batchNo}%`);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

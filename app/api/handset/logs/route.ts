import { NextResponse } from "next/server";
import { getCompanyUserContext } from "@/lib/handset-v2/db";
import { isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function GET(req: Request) {
  if (!isHandsetV2Enabled()) {
    return NextResponse.json({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") || "100");
  const limit = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));

  const { data, error } = await ctx.supabase
    .from("handset_logs")
    .select("id, company_id, handset_id, event_type, metadata, created_by, created_at")
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, logs: data || [] });
}
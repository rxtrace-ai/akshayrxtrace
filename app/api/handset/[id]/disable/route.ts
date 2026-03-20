import { NextResponse } from "next/server";
import { getCompanyUserContext, insertHandsetLog } from "@/lib/handset-v2/db";
import { isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function POST(req: Request, context: { params: { id: string } }) {
  if (!isHandsetV2Enabled()) {
    return NextResponse.json({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const handsetId = String(context.params.id || "").trim();
  if (!handsetId) {
    return NextResponse.json({ success: false, error: "INVALID_HANDSET_ID" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await ctx.supabase
    .from("handsets")
    .select("id, company_id, status, device_id")
    .eq("id", handsetId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 });
  }
  if (!existing || existing.company_id !== ctx.companyId) {
    return NextResponse.json({ success: false, error: "HANDSET_NOT_FOUND" }, { status: 404 });
  }

  const { data: updated, error } = await ctx.supabase
    .from("handsets")
    .update({
      status: "DISABLED",
      high_scan_enabled: false,
      disabled_by: ctx.userId,
      disabled_at: new Date().toISOString(),
    })
    .eq("id", handsetId)
    .eq("company_id", ctx.companyId)
    .select("id, status, disabled_at, disabled_by")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  await insertHandsetLog({
    supabase: ctx.supabase,
    companyId: ctx.companyId,
    handsetId,
    createdBy: ctx.userId,
    eventType: "handset_disabled",
    metadata: { device_id: existing.device_id || null },
  });

  return NextResponse.json({ success: true, handset: updated });
}
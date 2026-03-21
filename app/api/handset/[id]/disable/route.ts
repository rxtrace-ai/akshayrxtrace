import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getCompanyUserContext, insertHandsetLog } from "@/lib/handset-v2/db";
import { isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!isHandsetV2Enabled()) {
    return apiJson({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return apiJson({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const params = await context.params;
  const handsetId = String(params.id || "").trim();
  if (!handsetId) {
    return apiJson({ success: false, error: "INVALID_HANDSET_ID" }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await ctx.supabase
    .from("handsets")
    .select("id, company_id, status, device_id")
    .eq("id", handsetId)
    .maybeSingle();

  if (fetchError) {
    return apiJson({ success: false, error: fetchError.message }, { status: 500 });
  }
  if (!existing || existing.company_id !== ctx.companyId) {
    return apiJson({ success: false, error: "HANDSET_NOT_FOUND" }, { status: 404 });
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
    return apiJson({ success: false, error: error.message }, { status: 500 });
  }

  await insertHandsetLog({
    supabase: ctx.supabase,
    companyId: ctx.companyId,
    handsetId,
    createdBy: ctx.userId,
    eventType: "handset_disabled",
    metadata: { device_id: existing.device_id || null },
  });

  return apiJson({ success: true, handset: updated });
}

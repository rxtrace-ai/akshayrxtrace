import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getCompanyUserContext } from "@/lib/handset-v2/db";
import { deriveTokenStatus, isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function GET() {
  if (!isHandsetV2Enabled()) {
    return apiJson({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return apiJson({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const [handsetsResult, tokensResult] = await Promise.all([
    ctx.supabase
      .from("handsets")
      .select(
        "id, company_id, status, high_scan_enabled, device_id, platform, app_version, device_name, activated_by, activated_at, disabled_by, disabled_at"
      )
      .eq("company_id", ctx.companyId)
      .order("activated_at", { ascending: false }),
    ctx.supabase
      .from("handset_activation_tokens")
      .select("id, company_id, created_by, intended_user, max_activations, activation_count, expires_at, revoked_at, created_at")
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (handsetsResult.error) {
    return apiJson({ success: false, error: handsetsResult.error.message }, { status: 500 });
  }
  if (tokensResult.error) {
    return apiJson({ success: false, error: tokensResult.error.message }, { status: 500 });
  }

  const handsets = (handsetsResult.data || []).map((row: any) => ({
    ...row,
    is_active: String(row.status || "").toUpperCase() === "ACTIVE" && !row.disabled_at,
  }));

  const tokens = (tokensResult.data || []).map((row: any) => ({
    ...row,
    status: deriveTokenStatus(row),
  }));

  return apiJson({ success: true, handsets, tokens });
}


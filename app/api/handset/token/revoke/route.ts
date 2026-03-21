import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getCompanyUserContext, insertHandsetLog } from "@/lib/handset-v2/db";
import { isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function POST(req: Request) {
  if (!isHandsetV2Enabled()) {
    return apiJson({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return apiJson({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const body = (await req.json().catch(() => ({}))) as { token_id?: string };
  const tokenId = String(body.token_id || "").trim();
  if (!tokenId) {
    return apiJson({ success: false, error: "TOKEN_ID_REQUIRED" }, { status: 400 });
  }

  const { data: token, error: fetchError } = await ctx.supabase
    .from("handset_activation_tokens")
    .select("id, company_id, revoked_at")
    .eq("id", tokenId)
    .maybeSingle();

  if (fetchError) {
    return apiJson({ success: false, error: fetchError.message }, { status: 500 });
  }
  if (!token || token.company_id !== ctx.companyId) {
    return apiJson({ success: false, error: "TOKEN_NOT_FOUND" }, { status: 404 });
  }
  if (token.revoked_at) {
    return apiJson({ success: true, token: { ...token, status: "revoked" } });
  }

  const { data: updated, error } = await ctx.supabase
    .from("handset_activation_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("company_id", ctx.companyId)
    .select("id, company_id, revoked_at")
    .single();

  if (error) {
    return apiJson({ success: false, error: error.message }, { status: 500 });
  }

  await insertHandsetLog({
    supabase: ctx.supabase,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    eventType: "token_revoked",
    metadata: { token_id: tokenId },
  });

  return apiJson({ success: true, token: { ...updated, status: "revoked" } });
}

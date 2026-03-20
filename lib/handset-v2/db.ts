import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { supabaseServer } from "@/lib/supabase/server";

export async function getCompanyUserContext() {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  const admin = getSupabaseAdmin();
  const resolved = await resolveCompanyForUser(admin, user.id, "id");
  if (!resolved) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return {
    ok: true as const,
    userId: user.id,
    companyId: resolved.companyId,
    supabase: admin,
  };
}

export async function insertHandsetLog(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  handsetId?: string | null;
  createdBy?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  await params.supabase.from("handset_logs").insert({
    company_id: params.companyId,
    handset_id: params.handsetId ?? null,
    event_type: params.eventType,
    metadata: params.metadata ?? {},
    created_by: params.createdBy ?? null,
  });
}
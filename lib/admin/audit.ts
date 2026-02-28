import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function appendAdminMutationAuditEvent(params: {
  adminId: string;
  endpoint: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  correlationId: string;
  supabase?: ReturnType<typeof getSupabaseAdmin>;
}) {
  const supabase = params.supabase ?? getSupabaseAdmin();
  const { error } = await supabase.from("admin_mutation_audit_events").insert({
    admin_id: params.adminId,
    endpoint: params.endpoint,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    before_state_json: params.beforeState ?? null,
    after_state_json: params.afterState ?? null,
    correlation_id: params.correlationId,
    created_at: new Date().toISOString(),
  });

  if (!error) return;
  if (error.code === "42P01") {
    throw new Error("ADMIN_AUDIT_TABLE_MISSING");
  }
  throw new Error(error.message);
}


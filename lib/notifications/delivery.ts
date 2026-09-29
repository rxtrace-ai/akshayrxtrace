import type { TransactionalEmailEvent } from "@/lib/transactionalEmail";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function deliverNotification(params: {
  eventType: TransactionalEmailEvent;
  companyId: string;
  recipientEmail: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  event: TransactionalEmailEvent;
  payload: any;
  attachments?: Array<{ filename: string; contentBase64: string; contentType?: string }>;
}): Promise<"sent" | "duplicate"> {
  const admin = getSupabaseAdmin();
  const { data: claimed, error: claimError } = await admin.rpc("claim_notification_delivery", {
    p_event_type: params.eventType,
    p_company_id: params.companyId,
    p_recipient_email: params.recipientEmail,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata || {},
  });
  if (claimError) throw new Error(`Notification claim failed: ${claimError.message}`);
  if (!claimed) return "duplicate";

  try {
    await sendTransactionalEmail({
      to: params.recipientEmail,
      event: params.event as any,
      payload: params.payload,
      attachments: params.attachments,
      idempotencyKey: params.idempotencyKey,
    });
    const { error } = await admin.rpc("finish_notification_delivery", {
      p_idempotency_key: params.idempotencyKey,
      p_error: null,
    });
    if (error) throw new Error(`Notification ledger update failed: ${error.message}`);
    return "sent";
  } catch (error) {
    await admin.rpc("finish_notification_delivery", {
      p_idempotency_key: params.idempotencyKey,
      p_error: String((error as any)?.message || "EMAIL_SEND_FAILED").slice(0, 2000),
    });
    throw error;
  }
}

export async function getCompanyOwnerEmail(companyId: string) {
  const admin = getSupabaseAdmin();
  const { data: company, error } = await admin.from("companies").select("company_name,user_id").eq("id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  const userId = String(company?.user_id || "").trim();
  if (!userId) return null;
  const owner = await admin.auth.admin.getUserById(userId);
  const email = String(owner.data.user?.email || "").trim();
  if (!email) return null;
  return {
    email,
    name: String(owner.data.user?.user_metadata?.full_name || "there").trim() || "there",
    companyName: String(company?.company_name || "Company").trim() || "Company",
  };
}

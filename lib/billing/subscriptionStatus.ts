import type { SupabaseClient } from "@supabase/supabase-js";

export type UnifiedSubscriptionStatus = {
  status: "active" | "trial" | "expired";
  trialExpiresAt?: Date;
  subscription?: Record<string, any>;
};

const ACTIVE_STATUSES = new Set(["active", "authenticated", "activated", "charged"]);

export async function getUnifiedSubscriptionStatus(params: {
  supabase: SupabaseClient;
  companyId: string;
  now?: Date;
}): Promise<UnifiedSubscriptionStatus> {
  const now = params.now ?? new Date();

  const { data: companyRow, error: companyError } = await params.supabase
    .from("companies")
    .select("trial_expires_at")
    .eq("id", params.companyId)
    .maybeSingle();
  if (companyError) throw new Error(companyError.message);

  const { data: activeSub, error: subError } = await params.supabase
    .from("company_subscriptions")
    .select(
      `
      id,
      status,
      cancel_at_period_end,
      current_period_start,
      current_period_end,
      next_billing_at,
      plan_template_id,
      plan_version_id,
      subscription_plan_templates (
        name,
        billing_cycle,
        amount_from_razorpay
      )
    `
    )
    .eq("company_id", params.companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subError) throw new Error(subError.message);

  const statusRaw = String((activeSub as any)?.status || "")
    .trim()
    .toLowerCase();
  const hasActiveSubscription = Boolean(activeSub) && ACTIVE_STATUSES.has(statusRaw);

  if (hasActiveSubscription) {
    return {
      status: "active",
      subscription: activeSub as any,
    };
  }

  const trialExpiresAtIso = (companyRow as any)?.trial_expires_at ?? null;
  const trialExpiresAt = trialExpiresAtIso ? new Date(trialExpiresAtIso) : null;
  if (trialExpiresAt && !Number.isNaN(trialExpiresAt.getTime()) && trialExpiresAt.getTime() > now.getTime()) {
    return { status: "trial", trialExpiresAt };
  }

  return { status: "expired" };
}


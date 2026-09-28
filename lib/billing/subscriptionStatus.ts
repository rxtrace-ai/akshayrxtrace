import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEffectivePaidSubscriptionAccess,
  type LocalSubscriptionStatus,
} from "@/lib/billing/subscriptionAccess";

export type UnifiedSubscriptionStatus = {
  status: LocalSubscriptionStatus;
  source: "subscription" | null;
  subscription?: Record<string, any>;
  rawStatus?: LocalSubscriptionStatus | null;
  paidThroughPeriodEnd?: boolean;
  accessEndsAt?: string | null;
};

export async function getUnifiedSubscriptionStatus(params: {
  supabase: SupabaseClient;
  companyId: string;
  now?: Date;
}): Promise<UnifiedSubscriptionStatus> {
  const now = params.now ?? new Date();
  const { data: subscription, error } = await params.supabase
    .from("company_subscriptions")
    .select(`id,status,cancel_at_period_end,current_period_start,current_period_end,next_billing_at,start_date,renewal_date,plan_template_id,plan_version_id,billing_cycle,unit_subscription_quota,box_subscription_quota,carton_subscription_quota,pallet_subscription_quota,seat_limit,plant_limit,handset_limit,subscription_plan_templates(name,description,billing_cycle,plan_price)`)
    .eq("company_id", params.companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!subscription) return { status: "expired", source: null };

  const access = getEffectivePaidSubscriptionAccess({ subscription: subscription as any, now });
  if (access.rawStatus === "active" && access.effectiveStatus === "expired") {
    await params.supabase.from("company_subscriptions")
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("id", subscription.id);
  }

  return {
    status: access.effectiveStatus,
    source: "subscription",
    rawStatus: access.rawStatus,
    paidThroughPeriodEnd: access.paidThroughPeriodEnd,
    accessEndsAt: access.accessEndsAt?.toISOString() ?? null,
    subscription: {
      ...(subscription as any),
      ...(access.rawStatus === "active" && access.effectiveStatus === "expired" ? { status: "expired" } : {}),
    },
  };
}

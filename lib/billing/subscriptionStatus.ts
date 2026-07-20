import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEffectivePaidSubscriptionAccess,
  normalizeLocalSubscriptionStatus,
  type LocalSubscriptionStatus,
} from "@/lib/billing/subscriptionAccess";

export type UnifiedSubscriptionStatus = {
  status: LocalSubscriptionStatus;
  source: "trial" | "subscription" | null;
  trialExpiresAt?: Date;
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

  const { data: trialRow, error: trialError } = await params.supabase
    .from("company_trials")
    .select("trial_end, status")
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (trialError) throw new Error(trialError.message);

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
      start_date,
      renewal_date,
      plan_template_id,
      plan_version_id,
      billing_cycle,
      unit_subscription_quota,
      box_subscription_quota,
      carton_subscription_quota,
      pallet_subscription_quota,
      seat_limit,
      plant_limit,
      handset_limit,
      subscription_plan_templates (
        name,
        description,
        billing_cycle,
        plan_price
      )
    `
    )
    .eq("company_id", params.companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subError) throw new Error(subError.message);

  if (activeSub) {
    const paidAccess = getEffectivePaidSubscriptionAccess({
      subscription: activeSub as any,
      now,
    });

    if (paidAccess.rawStatus === "active" && paidAccess.effectiveStatus === "expired") {
      await params.supabase
        .from("company_subscriptions")
        .update({ status: "expired", updated_at: now.toISOString() })
        .eq("id", (activeSub as any).id);
      return {
        status: "expired",
        source: "subscription",
        rawStatus: "active",
        paidThroughPeriodEnd: false,
        accessEndsAt: paidAccess.accessEndsAt?.toISOString() ?? null,
        subscription: {
          ...(activeSub as any),
          status: "expired",
        },
      };
    }

    if (paidAccess.hasPaidAccess) {
      return {
        status: "active",
        source: "subscription",
        rawStatus: paidAccess.rawStatus,
        paidThroughPeriodEnd: paidAccess.paidThroughPeriodEnd,
        accessEndsAt: paidAccess.accessEndsAt?.toISOString() ?? null,
        subscription: activeSub as any,
      };
    }

    const subscriptionFallback: UnifiedSubscriptionStatus = {
      status: paidAccess.effectiveStatus,
      source: "subscription",
      rawStatus: paidAccess.rawStatus,
      paidThroughPeriodEnd: false,
      accessEndsAt: paidAccess.accessEndsAt?.toISOString() ?? null,
      subscription: activeSub as any,
    };

    const trialExpiresAtIso = (trialRow as any)?.trial_end ?? null;
    const trialStatus = String((trialRow as any)?.status || "").trim().toLowerCase();
    const trialExpiresAt = trialExpiresAtIso ? new Date(trialExpiresAtIso) : null;
    if (
      trialStatus === "active" &&
      trialExpiresAt &&
      !Number.isNaN(trialExpiresAt.getTime()) &&
      trialExpiresAt.getTime() > now.getTime()
    ) {
      return { status: "active", source: "trial", trialExpiresAt };
    }

    return {
      ...subscriptionFallback,
    };
  }

  const trialExpiresAtIso = (trialRow as any)?.trial_end ?? null;
  const trialStatus = String((trialRow as any)?.status || "").trim().toLowerCase();
  const trialExpiresAt = trialExpiresAtIso ? new Date(trialExpiresAtIso) : null;
  if (
    trialStatus === "active" &&
    trialExpiresAt &&
    !Number.isNaN(trialExpiresAt.getTime()) &&
    trialExpiresAt.getTime() > now.getTime()
  ) {
    return { status: "active", source: "trial", trialExpiresAt };
  }

  if (trialStatus === "cancelled") {
    return { status: "cancelled", source: "trial", trialExpiresAt: trialExpiresAt ?? undefined };
  }

  return { status: "expired", source: trialExpiresAt ? "trial" : null };
}

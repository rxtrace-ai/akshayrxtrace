export type LocalSubscriptionStatus = "active" | "pending" | "expired" | "cancelled";

export type EffectivePaidSubscriptionAccess = {
  rawStatus: LocalSubscriptionStatus;
  effectiveStatus: LocalSubscriptionStatus;
  hasPaidAccess: boolean;
  paidThroughPeriodEnd: boolean;
  accessEndsAt: Date | null;
};

export function normalizeLocalSubscriptionStatus(value: unknown): LocalSubscriptionStatus {
  const parsed = String(value || "").trim().toLowerCase();
  if (["active", "authenticated", "activated", "charged"].includes(parsed)) return "active";
  if (["cancelled", "canceled"].includes(parsed)) return "cancelled";
  if (["pending", "pending_payment", "trial", "trialing"].includes(parsed)) return "pending";
  return "expired";
}

export function getEffectivePaidSubscriptionAccess(params: {
  subscription: Record<string, any> | null | undefined;
  now?: Date;
}): EffectivePaidSubscriptionAccess {
  const now = params.now ?? new Date();
  const subscription = params.subscription ?? null;
  const rawStatus = normalizeLocalSubscriptionStatus(subscription?.status);
  const periodEndIso = String(subscription?.current_period_end || "").trim();
  const accessEndsAt =
    periodEndIso && !Number.isNaN(Date.parse(periodEndIso)) ? new Date(periodEndIso) : null;
  const periodEndInFuture = Boolean(accessEndsAt && accessEndsAt.getTime() > now.getTime());
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);

  if (rawStatus === "active") {
    if (accessEndsAt && accessEndsAt.getTime() <= now.getTime()) {
      return {
        rawStatus,
        effectiveStatus: "expired",
        hasPaidAccess: false,
        paidThroughPeriodEnd: false,
        accessEndsAt,
      };
    }

    return {
      rawStatus,
      effectiveStatus: "active",
      hasPaidAccess: true,
      paidThroughPeriodEnd: false,
      accessEndsAt,
    };
  }

  if (rawStatus === "cancelled" && cancelAtPeriodEnd && periodEndInFuture) {
    return {
      rawStatus,
      effectiveStatus: "active",
      hasPaidAccess: true,
      paidThroughPeriodEnd: true,
      accessEndsAt,
    };
  }

  if ((rawStatus === "cancelled" || rawStatus === "expired") && accessEndsAt && accessEndsAt.getTime() <= now.getTime()) {
    return {
      rawStatus,
      effectiveStatus: "expired",
      hasPaidAccess: false,
      paidThroughPeriodEnd: false,
      accessEndsAt,
    };
  }

  return {
    rawStatus,
    effectiveStatus: rawStatus,
    hasPaidAccess: false,
    paidThroughPeriodEnd: false,
    accessEndsAt,
  };
}

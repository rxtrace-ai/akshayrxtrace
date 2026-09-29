export type SubscriptionCycle = "monthly" | "yearly";

export type SubscriptionPeriodWindow = {
  periodStart: Date;
  periodEnd: Date;
};

function addAnchoredMonths(anchor: Date, monthOffset: number): Date {
  const monthIndex = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthOffset;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = Math.min(anchor.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(
    year,
    month,
    day,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  ));
}

export function getSubscriptionPeriodWindow(
  anchorValue: string | Date,
  cycle: SubscriptionCycle,
  atValue: string | Date = new Date(),
): SubscriptionPeriodWindow {
  const anchor = new Date(anchorValue);
  const at = new Date(atValue);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(at.getTime())) {
    throw new Error("INVALID_SUBSCRIPTION_PERIOD_DATE");
  }

  const stepMonths = cycle === "yearly" ? 12 : 1;
  let step = 0;
  let periodStart = addAnchoredMonths(anchor, step);
  let periodEnd = addAnchoredMonths(anchor, step + stepMonths);
  while (periodEnd <= at) {
    step += stepMonths;
    periodStart = periodEnd;
    periodEnd = addAnchoredMonths(anchor, step + stepMonths);
  }

  return { periodStart, periodEnd };
}

export function calculateRemainingQuota(opening: number, used: number): number {
  const safeOpening = Math.max(0, Math.trunc(Number(opening) || 0));
  const safeUsed = Math.max(0, Math.trunc(Number(used) || 0));
  return Math.max(safeOpening - safeUsed, 0);
}

import { describe, expect, it } from "vitest";
import { getEffectivePaidSubscriptionAccess } from "@/lib/billing/subscriptionAccess";

describe("getEffectivePaidSubscriptionAccess", () => {
  it("allows active subscriptions", () => {
    const result = getEffectivePaidSubscriptionAccess({
      subscription: {
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-05-10T00:00:00.000Z",
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(result.hasPaidAccess).toBe(true);
    expect(result.effectiveStatus).toBe("active");
    expect(result.paidThroughPeriodEnd).toBe(false);
  });

  it("keeps cancel-at-period-end subscriptions active until the paid period ends", () => {
    const result = getEffectivePaidSubscriptionAccess({
      subscription: {
        status: "cancelled",
        cancel_at_period_end: true,
        current_period_end: "2026-05-10T00:00:00.000Z",
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(result.hasPaidAccess).toBe(true);
    expect(result.effectiveStatus).toBe("active");
    expect(result.paidThroughPeriodEnd).toBe(true);
  });

  it("blocks cancelled subscriptions after the paid-through period ends", () => {
    const result = getEffectivePaidSubscriptionAccess({
      subscription: {
        status: "cancelled",
        cancel_at_period_end: true,
        current_period_end: "2026-04-10T00:00:00.000Z",
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(result.hasPaidAccess).toBe(false);
    expect(result.effectiveStatus).toBe("expired");
  });

  it("blocks immediately-cancelled subscriptions with no paid-through access window", () => {
    const result = getEffectivePaidSubscriptionAccess({
      subscription: {
        status: "cancelled",
        cancel_at_period_end: false,
        current_period_end: "2026-05-10T00:00:00.000Z",
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(result.hasPaidAccess).toBe(false);
    expect(result.effectiveStatus).toBe("cancelled");
  });
});

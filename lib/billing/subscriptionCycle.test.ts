import { describe, expect, it } from "vitest";
import { calculateRemainingQuota, getSubscriptionPeriodWindow } from "./subscriptionCycle";

describe("subscription cycle windows", () => {
  it("keeps a monthly period anchored to the subscription activation day", () => {
    const window = getSubscriptionPeriodWindow("2026-09-10T09:30:00.000Z", "monthly", "2026-09-29T00:00:00.000Z");
    expect(window.periodStart.toISOString()).toBe("2026-09-10T09:30:00.000Z");
    expect(window.periodEnd.toISOString()).toBe("2026-10-10T09:30:00.000Z");
  });

  it("starts the next monthly period exactly at the previous period end", () => {
    const window = getSubscriptionPeriodWindow("2026-09-10T09:30:00.000Z", "monthly", "2026-10-10T09:30:00.000Z");
    expect(window.periodStart.toISOString()).toBe("2026-10-10T09:30:00.000Z");
    expect(window.periodEnd.toISOString()).toBe("2026-11-10T09:30:00.000Z");
  });

  it("keeps yearly periods annual and anchored to activation", () => {
    const window = getSubscriptionPeriodWindow("2026-09-10T09:30:00.000Z", "yearly", "2027-09-11T00:00:00.000Z");
    expect(window.periodStart.toISOString()).toBe("2027-09-10T09:30:00.000Z");
    expect(window.periodEnd.toISOString()).toBe("2028-09-10T09:30:00.000Z");
  });

  it("clamps remaining to zero without changing used quota", () => {
    expect(calculateRemainingQuota(1_000, 600)).toBe(400);
    expect(calculateRemainingQuota(500, 600)).toBe(0);
  });
});

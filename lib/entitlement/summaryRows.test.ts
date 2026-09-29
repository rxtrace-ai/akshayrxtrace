import { describe, expect, it } from "vitest";
import type { EntitlementSnapshot } from "./canonical";
import { buildCapacitySummaryRows, buildQuotaSummaryRows } from "./summaryRows";

function snapshot(values: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return {
    state: "FREE_ACTIVE", period_start: "2026-09-01T00:00:00.000Z", period_end: null,
    quota_period_end: "2026-10-01T00:00:00.000Z", blocked: false,
    limits: { unit: 100, box: 50, carton: 25, pallet: 10, seat: 5, plant: 2, handset: 3 },
    usage: { unit: 15, box: 4, carton: 5, pallet: 1, seat: 2, plant: 1, handset: 1 },
    topups: { unit: 0, box: 0, carton: 0, pallet: 0 },
    remaining: { unit: 85, box: 46, carton: 20, pallet: 9, seat: 3, plant: 1, handset: 2 },
    ...values,
  };
}

describe("canonical entitlement display rows", () => {
  it.each(["FREE_ACTIVE", "PAID_ACTIVE"])("projects %s quotas as opening, used, and closing", (state) => {
    const input = snapshot({ state });
    const rows = buildQuotaSummaryRows(input);
    expect(rows.find((row) => row.metric === "unit")).toMatchObject({ opening: 100, used: 15, remaining: 85 });
    expect(rows.every((row) => row.remaining === row.opening - row.used)).toBe(true);
  });

  it("uses the snapshot for subscription capacities and does not treat them as quota-period resets", () => {
    const rows = buildCapacitySummaryRows(snapshot(), { seat: 0, plant: 0, handset: 0 });
    expect(rows.find((row) => row.metric === "seat")).toMatchObject({ opening: 5, used: 2, remaining: 3 });
  });

  it("uses top-up totals only for their separate allocation breakdown", () => {
    const rows = buildQuotaSummaryRows(snapshot({
      limits: { unit: 125, box: 50, carton: 25, pallet: 10, seat: 5, plant: 2, handset: 3 },
      topups: { unit: 25, box: 0, carton: 0, pallet: 0 },
    }));
    expect(rows.find((row) => row.metric === "unit")).toMatchObject({ opening: 125, subscription_allocated: 100, addon_allocated: 25 });
  });

  it("clamps closing quota to zero but preserves actual used quantity", () => {
    const rows = buildQuotaSummaryRows(snapshot({
      limits: { unit: 500, box: 50, carton: 25, pallet: 10, seat: 5, plant: 2, handset: 3 },
      usage: { unit: 600, box: 4, carton: 5, pallet: 1, seat: 2, plant: 1, handset: 1 },
      remaining: { unit: 0, box: 46, carton: 20, pallet: 9, seat: 3, plant: 1, handset: 2 },
    }));
    expect(rows.find((row) => row.metric === "unit")).toMatchObject({ opening: 500, used: 600, remaining: 0 });
  });
});

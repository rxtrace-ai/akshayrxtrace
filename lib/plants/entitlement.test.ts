import { describe, expect, it } from "vitest";
import { normalizePlantEntitlement } from "./entitlement";

describe("plant entitlement quota decisions", () => {
  it("allows activation with limit one and no active plants", () => {
    expect(normalizePlantEntitlement({
      state: "PAID_ACTIVE",
      limits: { plant: 1 },
      usage: { plant: 0 },
      remaining: { plant: 1 },
    })).toMatchObject({ allocated: 1, active: 0, remaining: 1, blocked: false, reason: null });
  });

  it("blocks another activation at limit one with one active plant", () => {
    expect(normalizePlantEntitlement({
      state: "PAID_ACTIVE",
      limits: { plant: 1 },
      usage: { plant: 1 },
      remaining: { plant: 0 },
    })).toMatchObject({ allocated: 1, active: 1, remaining: 0, blocked: true, reason: "quota_exceeded" });
  });

  it("blocks activation when no plant quota is allocated", () => {
    expect(normalizePlantEntitlement({
      state: "PAID_ACTIVE",
      limits: { plant: 0 },
      usage: { plant: 0 },
      remaining: { plant: 0 },
    })).toMatchObject({ allocated: 0, active: 0, remaining: 0, blocked: true, reason: "quota_exceeded" });
  });

  it("uses the same effective limit and usage values exposed to the Subscription page", () => {
    const snapshot = {
      state: "PAID_ACTIVE",
      limits: { plant: 1 },
      usage: { plant: 0 },
      remaining: { plant: 1 },
    };
    const pageValues = {
      allocated: snapshot.limits.plant,
      active: snapshot.usage.plant,
      remaining: snapshot.remaining.plant,
    };
    expect(normalizePlantEntitlement(snapshot)).toMatchObject({ ...pageValues, blocked: false });
  });
});

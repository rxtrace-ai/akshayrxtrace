import { describe, expect, it } from "vitest";
import { resolveUpdatedRazorpayPlanId } from "./subscriptionPlanValidation";

describe("resolveUpdatedRazorpayPlanId", () => {
  it("allows FREE to keep the intentionally empty provider plan id", () => {
    expect(resolveUpdatedRazorpayPlanId("", "FREE")).toBeNull();
  });

  it("keeps provider plan id validation for paid plans", () => {
    expect(() => resolveUpdatedRazorpayPlanId("", "STARTER")).toThrow("razorpay_plan_id is required");
  });

  it("normalizes a provided provider plan id", () => {
    expect(resolveUpdatedRazorpayPlanId("  plan_123  ", "GROWTH")).toBe("plan_123");
  });
});

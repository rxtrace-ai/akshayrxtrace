export function resolveUpdatedRazorpayPlanId(value: unknown, planName: unknown): string | null {
  const planId = String(value ?? "").trim();
  const isFreePlan = String(planName ?? "").trim().toUpperCase() === "FREE";
  if (!planId && !isFreePlan) {
    throw new Error("razorpay_plan_id is required");
  }
  return planId || null;
}

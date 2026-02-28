import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planDefinitions = [
  {
    envKey: "RAZORPAY_PLAN_STARTER_MONTHLY",
    name: "Starter Monthly",
    cycle: "Monthly",
    quotas: { unitLimit: 500, boxLimit: 250, cartonLimit: 120, palletLimit: 60, seatLimit: 10, plantLimit: 2 },
  },
  {
    envKey: "RAZORPAY_PLAN_STARTER_YEARLY",
    name: "Starter Yearly",
    cycle: "Yearly",
    quotas: { unitLimit: 750, boxLimit: 380, cartonLimit: 190, palletLimit: 90, seatLimit: 15, plantLimit: 3 },
  },
  {
    envKey: "RAZORPAY_PLAN_GROWTH_MONTHLY",
    name: "Growth Monthly",
    cycle: "Monthly",
    quotas: { unitLimit: 1200, boxLimit: 600, cartonLimit: 320, palletLimit: 150, seatLimit: 25, plantLimit: 5 },
  },
  {
    envKey: "RAZORPAY_PLAN_GROWTH_YEARLY",
    name: "Growth Yearly",
    cycle: "Yearly",
    quotas: { unitLimit: 2000, boxLimit: 950, cartonLimit: 500, palletLimit: 240, seatLimit: 40, plantLimit: 8 },
  },
];

export async function GET() {
  const now = new Date();
  const periodStart = process.env.RAZORPAY_PLAN_PERIOD_START || now.toISOString().split("T")[0];
  const periodEnd =
    process.env.RAZORPAY_PLAN_PERIOD_END ||
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const plans = planDefinitions.map((plan, index) => ({
    subscriptionId: process.env[plan.envKey] || `plan_placeholder_${index + 1}`,
    name: plan.name,
    billingTimeline: plan.cycle,
    amount: {
      value: Number(process.env[`${plan.envKey}_PRICE`] || "0"),
      currency: process.env.RAZORPAY_PLAN_CURRENCY || "INR",
    },
    status: process.env.RAZORPAY_PLAN_STATUS || "ACTIVE",
    periodStart,
    periodEnd,
    quotas: plan.quotas,
  }));

  return NextResponse.json({ success: true, plans });
}

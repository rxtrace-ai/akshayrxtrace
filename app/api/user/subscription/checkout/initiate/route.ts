import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "CHECKOUT_INITIATE_DEPRECATED_USE_QUOTE_ID",
      message: "Use /api/user/subscription/checkout/payment/initiate with quote_id only.",
    },
    { status: 410 }
  );
}

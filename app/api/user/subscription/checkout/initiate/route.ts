import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return apiJson(
    {
      error: "CHECKOUT_INITIATE_DEPRECATED_USE_QUOTE_ID",
      message: "Use /api/user/subscription/checkout/payment/initiate with quote_id only.",
    },
    { status: 410 }
  );
}


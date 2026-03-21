import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return apiJson(
    {
      error: "Client-side payment confirmation is disabled in Phase-2. Payment activation will be implemented in Phase-3.",
    },
    { status: 410 }
  );
}


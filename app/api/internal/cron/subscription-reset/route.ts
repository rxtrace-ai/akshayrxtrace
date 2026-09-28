import { NextRequest } from "next/server";
import { apiJson } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const expected = String(process.env.CRON_SECRET || process.env.INTERNAL_SYNC_TOKEN || "").trim();
  const authorization = request.headers.get("authorization") || "";
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) return apiJson({ success: false, error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabaseAdmin().rpc("run_universal_subscription_reset", {
    p_at: new Date().toISOString(),
  });
  if (error) return apiJson({ success: false, error: error.message }, { status: 500 });
  return apiJson({ success: true, result: data });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

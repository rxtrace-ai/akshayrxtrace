import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireInternalAuth(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_RECONCILE_SECRET?.trim();
  if (!expected) return false;
  const provided = req.headers.get("x-internal-secret")?.trim() || "";
  return provided.length > 0 && provided === expected;
}

export async function POST(req: NextRequest) {
  const correlationId = getOrGenerateCorrelationId(req.headers, "internal");
  if (!requireInternalAuth(req)) {
    return NextResponse.json({ error: "Forbidden", correlation_id: correlationId }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  // Phase 7 scaffold: reconciliation reads local state and flags missing webhook-derived fields.
  // A full Razorpay sync (network) will be added once webhook coverage is stable in production.
  const { data: subscriptions, error } = await supabase
    .from("company_subscriptions")
    .select("company_id, status, razorpay_subscription_id, current_period_start, current_period_end, updated_at")
    .in("status", ["active", "authenticated", "pending", "paused", "past_due"])
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message, correlation_id: correlationId }, { status: 500 });
  }

  const missingPeriod = (subscriptions || []).filter(
    (row: any) => row.status === "active" && (!row.current_period_start || !row.current_period_end)
  );

  return NextResponse.json({
    success: true,
    correlation_id: correlationId,
    checked: (subscriptions || []).length,
    missing_period: missingPeriod.map((row: any) => ({
      company_id: row.company_id,
      razorpay_subscription_id: row.razorpay_subscription_id,
      status: row.status,
      updated_at: row.updated_at,
    })),
    note: "Reconciliation scaffold only (no external Razorpay fetch in this phase).",
  });
}


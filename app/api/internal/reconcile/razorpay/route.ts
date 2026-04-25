import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";
import { logError, logInfo } from "@/lib/observability";
import { reconcileRazorpayPayments } from "@/lib/billing/razorpayReconcile";

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
    return apiJson({ error: "Forbidden", correlation_id: correlationId }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const result = await reconcileRazorpayPayments({
      supabase: supabase as any,
      correlationId,
    });

    logInfo("RAZORPAY_RECONCILE_COMPLETED", {
      operation: "razorpay_reconcile",
      correlationId,
      checked: result.checked,
      repaired_count: result.repaired.length,
      unchanged_count: result.unchanged.length,
      missing_provider_count: result.missingProvider.length,
      failure_count: result.failures.length,
    });

    return apiJson({
      success: true,
      correlation_id: correlationId,
      checked: result.checked,
      repaired_count: result.repaired.length,
      unchanged_count: result.unchanged.length,
      missing_provider_count: result.missingProvider.length,
      failure_count: result.failures.length,
      repaired: result.repaired,
      missing_provider: result.missingProvider,
      failures: result.failures,
    });
  } catch (error: any) {
    logError("RAZORPAY_RECONCILE_LOAD_FAILED", {
      operation: "razorpay_reconcile",
      correlationId,
      error: String(error?.message || error),
    });
    return apiJson(
      { error: String(error?.message || "RAZORPAY_RECONCILE_FAILED"), correlation_id: correlationId },
      { status: 500 }
    );
  }
}



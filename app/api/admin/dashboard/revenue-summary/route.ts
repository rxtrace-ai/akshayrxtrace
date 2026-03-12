import { headers } from "next/headers";
import { requireAdminRole } from "@/lib/auth/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId } from "@/lib/observability";
import { errorResponse, successResponse } from "@/lib/admin/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "admin");

  const auth = await requireAdminRole(["super_admin", "billing_admin", "support_admin"]);
  if (auth.error) return errorResponse(403, "FORBIDDEN", "Admin access required", correlationId);

  const supabase = getSupabaseAdmin();

  const { data: invoiceRows, error: invoiceError } = await supabase
  .from("billing_invoices")
  .select("amount, status, metadata")
  .in("status", ["paid", "PAID", "captured", "CAPTURED"]);
  
  if (invoiceError) {
    return errorResponse(500, "INTERNAL_ERROR", invoiceError.message, correlationId);
  }

  const { data: walletRows, error: walletError } = await supabase
    .from("wallet_transactions")
    .select("amount, type");

  if (walletError) {
    return errorResponse(500, "INTERNAL_ERROR", walletError.message, correlationId);
  }

  let subscriptionRevenue = 0;
  let addOnRevenue = 0;
  for (const row of invoiceRows || []) {
    const amount = Number((row as any).amount || 0);
    subscriptionRevenue += amount;
    const metadata = (row as any).metadata || {};
    const addOns = Number(metadata?.pricing?.addons || 0);
    addOnRevenue += addOns;
  }

  let walletEarnings = 0;
  for (const row of walletRows || []) {
    if (String((row as any).type || "").toLowerCase() === "debit") {
      walletEarnings += Number((row as any).amount || 0);
    }
  }

  return successResponse(
    200,
    {
      success: true,
      totals: {
        subscription_revenue_paise: subscriptionRevenue,
        addon_revenue_paise: addOnRevenue,
        wallet_earnings_paise: walletEarnings,
      },
    },
    correlationId
  );
}

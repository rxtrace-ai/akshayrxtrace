import { NextRequest } from "next/server";
import { apiJson } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deliverNotification, getCompanyOwnerEmail } from "@/lib/notifications/delivery";

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
  const admin = getSupabaseAdmin();
  let resetEmailsSent = 0;
  const periodStart = String((data as any)?.period_start || "");
  if (periodStart) {
    const { data: periods, error: periodError } = await admin
      .from("subscription_quota_periods")
      .select("company_id,subscription_id,period_start,period_end")
      .eq("source", "free_monthly")
      .eq("period_start", periodStart);
    if (periodError) return apiJson({ success: false, error: periodError.message, result: data }, { status: 500 });

    for (const period of periods || []) {
      try {
        const companyId = String(period.company_id);
        const owner = await getCompanyOwnerEmail(companyId);
        if (!owner) continue;
        const { data: allocations, error: allocationError } = await admin
          .from("quota_allocations")
          .select("resource,amount")
          .eq("company_id", companyId)
          .eq("subscription_id", String(period.subscription_id))
          .eq("period_start", periodStart)
          .eq("source", "subscription")
          .eq("quota_type", "base");
        if (allocationError) throw new Error(allocationError.message);
        const fresh = Object.fromEntries(["unit", "box", "carton", "pallet"].map((resource) => [
          resource,
          (allocations || []).filter((row: any) => row.resource === resource).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
        ]));
        const quotas = [`Unit QR ${fresh.unit}`, `Box QR ${fresh.box}`, `Carton QR ${fresh.carton}`, `Pallet SSCC ${fresh.pallet}`].join(" • ");
        const resetDate = new Date(String(period.period_start)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
        const nextResetDate = new Date(String(period.period_end)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
        const result = await deliverNotification({
          eventType: "FREE_QUOTA_RESET", event: "FREE_QUOTA_RESET", companyId,
          recipientEmail: owner.email,
          idempotencyKey: `free-quota-reset:${period.subscription_id}:${periodStart}`,
          metadata: { subscription_id: period.subscription_id, period_start: periodStart, period_end: period.period_end },
          payload: { user_name: owner.name, company_name: owner.companyName, quotas, reset_date: resetDate, next_reset_date: nextResetDate },
        });
        if (result === "sent") resetEmailsSent += 1;
      } catch (notificationError) {
        console.error("[Subscription Reset] FREE reset email failed", { company_id: period.company_id, error: String((notificationError as any)?.message || notificationError) });
      }
    }
  }
  return apiJson({ success: true, result: data, free_reset_emails_sent: resetEmailsSent });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

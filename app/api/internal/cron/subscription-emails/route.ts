import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/config";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(authHeader: string | null): boolean {
  const secret = String(process.env.INTERNAL_SYNC_TOKEN || process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === secret;
}

function daysUntilUtc(dateIso: string): number {
  const target = new Date(dateIso);
  const now = new Date();
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((targetUtc - nowUtc) / (24 * 60 * 60 * 1000));
}

function formatDateForEmail(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function POST() {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (!isAuthorized(authHeader)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const appUrl = getAppUrl();
  const renewLink = `${appUrl}/dashboard/subscription`;
  const upgradeLink = `${appUrl}/pricing`;

  const stats = {
    companies_checked: 0,
    sent_trial_expired: 0,
    sent_reminder_7: 0,
    sent_reminder_2: 0,
    sent_subscription_expired: 0,
    skipped_no_owner_email: 0,
    errors: [] as Array<{ company_id: string; error: string }>,
  };

  const { data: companies, error: companyError } = await admin
    .from("companies")
    .select("id, company_name, user_id");

  if (companyError) {
    return NextResponse.json({ success: false, error: companyError.message }, { status: 500 });
  }

  for (const company of companies || []) {
    const companyId = String((company as any).id || "").trim();
    const ownerUserId = String((company as any).user_id || "").trim();
    if (!companyId || !ownerUserId) continue;

    stats.companies_checked += 1;

    try {
      const ownerResult = await admin.auth.admin.getUserById(ownerUserId);
      const ownerEmail = String(ownerResult?.data?.user?.email || "").trim();
      if (!ownerEmail) {
        stats.skipped_no_owner_email += 1;
        continue;
      }
      const ownerName =
        String((ownerResult?.data?.user?.user_metadata as any)?.full_name || "").trim() || "there";

      const [entitlement, subscription] = await Promise.all([
        getCompanyEntitlementSnapshot(admin, companyId),
        getUnifiedSubscriptionStatus({ supabase: admin, companyId }),
      ]);

      if (!entitlement.trial_active && entitlement.trial_expires_at) {
        const trialDays = daysUntilUtc(entitlement.trial_expires_at);
        if (trialDays === 0) {
          await sendTransactionalEmail({
            to: ownerEmail,
            event: "TRIAL_EXPIRED",
            payload: {
              user_name: ownerName,
              upgrade_link: upgradeLink,
            },
          });
          stats.sent_trial_expired += 1;
        }
      }

      const currentPeriodEnd = String((subscription.subscription as any)?.current_period_end || "").trim();
      if (!currentPeriodEnd) continue;

      const daysUntilExpiry = daysUntilUtc(currentPeriodEnd);
      const expiryDate = formatDateForEmail(currentPeriodEnd);

      if (subscription.status === "active" && daysUntilExpiry === 7) {
        await sendTransactionalEmail({
          to: ownerEmail,
          event: "SUBSCRIPTION_REMINDER_7",
          payload: {
            user_name: ownerName,
            expiry_date: expiryDate,
            renew_link: renewLink,
          },
        });
        stats.sent_reminder_7 += 1;
      } else if (subscription.status === "active" && daysUntilExpiry === 2) {
        await sendTransactionalEmail({
          to: ownerEmail,
          event: "SUBSCRIPTION_REMINDER_2",
          payload: {
            user_name: ownerName,
            expiry_date: expiryDate,
            renew_link: renewLink,
          },
        });
        stats.sent_reminder_2 += 1;
      } else if (subscription.status === "expired" && daysUntilExpiry === 0) {
        await sendTransactionalEmail({
          to: ownerEmail,
          event: "SUBSCRIPTION_EXPIRED",
          payload: {
            user_name: ownerName,
            renew_link: renewLink,
          },
        });
        stats.sent_subscription_expired += 1;
      }
    } catch (error: any) {
      stats.errors.push({
        company_id: companyId,
        error: String(error?.message || "UNKNOWN_ERROR"),
      });
    }
  }

  return NextResponse.json({
    success: true,
    ...stats,
  });
}


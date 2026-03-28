import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { loadCheckoutCatalog } from "@/lib/billing/userCheckout";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const catalog = await loadCheckoutCatalog(owner.supabase);

    const subscriptionStatus = await getUnifiedSubscriptionStatus({
      supabase: owner.supabase as any,
      companyId: owner.companyId,
    });

    const currentSubscription = subscriptionStatus.subscription ?? null;

    return apiJson({
      success: true,
      company: {
        id: owner.companyId,
        name: owner.companyName,
      },
      plans: catalog.plans.map((plan) => ({
        template_id: plan.template_id,
        name: plan.template_name,
        description: plan.description,
        billing_cycle: plan.billing_cycle,
        plan_price_paise: plan.plan_price_paise,
        pricing_unit_size: plan.pricing_unit_size,
        version_id: plan.version_id,
        version_number: plan.version_number,
        quota_units: plan.quota_units,
        quotas: plan.quotas,
        capacities: plan.capacities,
      })),
      add_ons: catalog.addOns.map((addon) => ({
        id: addon.id,
        name: addon.name,
        description: addon.description,
        price_inr: addon.price,
        pricing_unit_size: addon.pricing_unit_size,
        unit: addon.unit,
        duration_days: (addon as any).duration_days ?? null,
        addon_kind: addon.addon_kind,
        entitlement_key: addon.entitlement_key,
        billing_mode: addon.billing_mode,
      })),
      subscriptionStatus: {
        status: subscriptionStatus.status,
        trialExpiresAt: subscriptionStatus.trialExpiresAt ? subscriptionStatus.trialExpiresAt.toISOString() : null,
      },
      current_subscription: currentSubscription
        ? {
            id: (currentSubscription as any).id,
            status: (currentSubscription as any).status,
            cancel_at_period_end: Boolean((currentSubscription as any).cancel_at_period_end),
            current_period_start: (currentSubscription as any).current_period_start,
            current_period_end: (currentSubscription as any).current_period_end,
            next_billing_at: (currentSubscription as any).next_billing_at,
            start_date: (currentSubscription as any).start_date ?? null,
            renewal_date: (currentSubscription as any).renewal_date ?? null,
            plan_name: (currentSubscription as any).subscription_plan_templates?.name ?? null,
            billing_cycle:
              (currentSubscription as any).billing_cycle ??
              (currentSubscription as any).subscription_plan_templates?.billing_cycle ??
              null,
            plan_price_paise: (currentSubscription as any).subscription_plan_templates?.plan_price ?? 0,
          }
        : null,
    });
  } catch (error: any) {
    return apiJson(
      { error: error?.message || "Failed to load checkout context" },
      { status: 500 }
    );
  }
}


import { NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { loadCheckoutCatalog } from "@/lib/billing/userCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const catalog = await loadCheckoutCatalog(owner.supabase);

    const { data: currentSubscription, error: subscriptionError } = await owner.supabase
      .from("company_subscriptions")
      .select(
        "id, status, current_period_start, current_period_end, next_billing_at, plan_template_id, plan_version_id, subscription_plan_templates(name, billing_cycle, amount_from_razorpay)"
      )
      .eq("company_id", owner.companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) {
      return NextResponse.json({ error: subscriptionError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      company: {
        id: owner.companyId,
        name: owner.companyName,
      },
      plans: catalog.plans.map((plan) => ({
        template_id: plan.template_id,
        name: plan.template_name,
        billing_cycle: plan.billing_cycle,
        amount_paise: plan.amount_from_razorpay,
        version_id: plan.version_id,
        version_number: plan.version_number,
        limits: plan.limits,
      })),
      add_ons: catalog.addOns.map((addon) => ({
        id: addon.id,
        name: addon.name,
        price_inr: addon.price,
        unit: addon.unit,
        addon_kind: addon.addon_kind,
        entitlement_key: addon.entitlement_key,
        billing_mode: addon.billing_mode,
      })),
      eligible_coupons: catalog.coupons.map((coupon) => ({
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        scope: coupon.scope,
      })),
      current_subscription: currentSubscription
        ? {
            id: (currentSubscription as any).id,
            status: (currentSubscription as any).status,
            current_period_start: (currentSubscription as any).current_period_start,
            current_period_end: (currentSubscription as any).current_period_end,
            next_billing_at: (currentSubscription as any).next_billing_at,
            plan_name: (currentSubscription as any).subscription_plan_templates?.name ?? null,
            billing_cycle: (currentSubscription as any).subscription_plan_templates?.billing_cycle ?? null,
            amount_paise: (currentSubscription as any).subscription_plan_templates?.amount_from_razorpay ?? 0,
          }
        : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load checkout context" },
      { status: 500 }
    );
  }
}


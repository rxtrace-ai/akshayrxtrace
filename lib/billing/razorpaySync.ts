import { getSupabaseAdmin } from "@/lib/supabase/admin";

type RazorpayPlanItem = {
  id: string;
  period?: string | null;
  status?: string | null;
  item?: {
    name?: string | null;
    amount?: number | null;
  } | null;
};

type RazorpayPlansResponse = {
  items?: RazorpayPlanItem[];
  count?: number;
};

export type SyncRazorpayPlansResult = {
  fetched: number;
  synced: number;
  skipped: number;
  errors: string[];
};

function getRazorpayApiConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new Error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET");
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return { auth };
}

async function fetchRazorpayPlansPage(skip: number, count: number): Promise<RazorpayPlanItem[]> {
  const { auth } = getRazorpayApiConfig();
  const response = await fetch(`https://api.razorpay.com/v1/plans?count=${count}&skip=${skip}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Razorpay plans fetch failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as RazorpayPlansResponse;
  return Array.isArray(payload.items) ? payload.items : [];
}

function mapRazorpayPeriodToBillingCycle(period: string | null | undefined): "monthly" | "yearly" | null {
  if (period === "monthly") return "monthly";
  if (period === "yearly") return "yearly";
  return null;
}

export async function syncRazorpayPlansToTemplates(): Promise<SyncRazorpayPlansResult> {
  const supabase = getSupabaseAdmin();
  const errors: string[] = [];
  const pageSize = 100;
  let skip = 0;
  let fetched = 0;
  let synced = 0;
  let skipped = 0;

  while (true) {
    const items = await fetchRazorpayPlansPage(skip, pageSize);
    if (!items.length) break;

    fetched += items.length;

    const upserts: Array<{
      name: string;
      razorpay_plan_id: string;
      billing_cycle: "monthly" | "yearly";
      amount_from_razorpay: number;
      is_active: boolean;
      updated_at: string;
    }> = [];

    for (const plan of items) {
      const billingCycle = mapRazorpayPeriodToBillingCycle(plan.period);
      const amount = Number(plan.item?.amount ?? 0);
      const planId = typeof plan.id === "string" ? plan.id.trim() : "";
      if (!planId || !billingCycle || !Number.isFinite(amount) || amount < 0) {
        skipped += 1;
        continue;
      }

      upserts.push({
        name: (plan.item?.name || planId).trim(),
        razorpay_plan_id: planId,
        billing_cycle: billingCycle,
        amount_from_razorpay: Math.trunc(amount),
        is_active: plan.status === "active",
        updated_at: new Date().toISOString(),
      });
    }

    if (upserts.length) {
      const { error } = await supabase
        .from("subscription_plan_templates")
        .upsert(upserts, {
          onConflict: "razorpay_plan_id",
          ignoreDuplicates: false,
        });

      if (error) {
        errors.push(error.message);
      } else {
        synced += upserts.length;
      }
    }

    if (items.length < pageSize) break;
    skip += pageSize;
  }

  return { fetched, synced, skipped, errors };
}

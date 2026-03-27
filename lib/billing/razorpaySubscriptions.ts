type RazorpaySubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "cancelled"
  | "completed"
  | "expired";

export type RazorpaySubscriptionEntity = {
  id: string;
  plan_id?: string | null;
  customer_id?: string | null;
  status?: RazorpaySubscriptionStatus | string | null;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  total_count?: number | null;
  paid_count?: number | null;
  remaining_count?: number | null;
  notes?: Record<string, string> | null;
};

type CreateRazorpaySubscriptionParams = {
  planId: string;
  quoteId: string;
  companyId: string;
  userId: string;
  correlationId: string;
  expireAtIso?: string | null;
  totalCount?: number;
};

type CancelRazorpaySubscriptionParams = {
  subscriptionId: string;
  cancelAtCycleEnd?: boolean;
};

function getRazorpayAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_NOT_CONFIGURED");
  }

  return {
    keyId,
    authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
  };
}

async function razorpayRequest<T>(path: string, init: RequestInit): Promise<T> {
  const { authorization } = getRazorpayAuthHeader();
  const response = await fetch(`https://api.razorpay.com${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RAZORPAY_API_ERROR_${response.status}:${body}`);
  }

  return (await response.json()) as T;
}

function toUnixTimestamp(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const timestamp = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
}

export function getRazorpaySubscriptionTotalCount(billingCycle: string | null | undefined): number {
  return String(billingCycle || "").trim().toLowerCase() === "yearly" ? 100 : 1200;
}

export function mapRazorpaySubscriptionStatusToLocal(value: unknown): "active" | "pending" | "pending_payment" | "expired" | "cancelled" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "created") return "pending_payment";
  if (["authenticated", "active"].includes(normalized)) return "active";
  if (["pending", "halted"].includes(normalized)) return "pending";
  if (normalized === "cancelled") return "cancelled";
  return "expired";
}

export function toIsoFromUnix(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(Math.trunc(numeric) * 1000).toISOString();
}

export async function createRazorpaySubscription(
  params: CreateRazorpaySubscriptionParams
): Promise<RazorpaySubscriptionEntity> {
  const payload = {
    plan_id: params.planId,
    total_count: params.totalCount ?? 1200,
    quantity: 1,
    customer_notify: 1,
    expire_by: toUnixTimestamp(params.expireAtIso || null),
    notes: {
      quote_id: params.quoteId,
      company_id: params.companyId,
      user_id: params.userId,
      correlation_id: params.correlationId,
    },
  };

  return await razorpayRequest<RazorpaySubscriptionEntity>("/v1/subscriptions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchRazorpaySubscription(subscriptionId: string): Promise<RazorpaySubscriptionEntity> {
  return await razorpayRequest<RazorpaySubscriptionEntity>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "GET" }
  );
}

export async function cancelRazorpaySubscription(
  params: CancelRazorpaySubscriptionParams
): Promise<RazorpaySubscriptionEntity> {
  return await razorpayRequest<RazorpaySubscriptionEntity>(
    `/v1/subscriptions/${encodeURIComponent(params.subscriptionId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({
        cancel_at_cycle_end: params.cancelAtCycleEnd === false ? 0 : 1,
      }),
    }
  );
}

export function getRazorpayPublishableKey(): string | null {
  const configured = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
  if (configured) return configured;
  return getRazorpayAuthHeader().keyId;
}

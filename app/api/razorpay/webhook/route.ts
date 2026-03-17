import crypto from "crypto";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getOrGenerateCorrelationId, logWithContext } from "@/lib/observability";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function withCorrelation(
  payload: Record<string, unknown>,
  status: number,
  correlationId: string
) {
  const response = NextResponse.json(
    {
      ...payload,
      correlation_id: correlationId,
    },
    { status }
  );
  response.headers.set("X-Correlation-Id", correlationId);
  return response;
}

function deriveEventId(parsedBody: any, rawBody: string): string {
  const fromPayload = parsedBody?.event_id ?? parsedBody?.id;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim();
  const digest = crypto.createHash("sha256").update(rawBody).digest("hex");
  return `body_sha256:${digest}`;
}

function extractOrderId(parsedBody: any): string | null {
  const orderId =
    parsedBody?.payload?.order?.entity?.id ??
    parsedBody?.payload?.payment?.entity?.order_id ??
    null;
  const out = typeof orderId === "string" ? orderId.trim() : "";
  return out ? out : null;
}

function extractPayment(parsedBody: any): { id: string | null; status: string | null; amount: number | null } {
  const entity = parsedBody?.payload?.payment?.entity ?? null;
  const id = typeof entity?.id === "string" ? entity.id.trim() : null;
  const status = typeof entity?.status === "string" ? entity.status.trim().toLowerCase() : null;
  const amountRaw = entity?.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  return { id, status, amount: Number.isFinite(amount) ? amount : null };
}

function deriveSubscriptionStatus(eventType: string): "pending" | "active" | "cancelled" | "expired" {
  const lifecycle = String(eventType || "").split(".")[1] || "";
  switch (lifecycle.toLowerCase()) {
    case "activated":
    case "charged":
    case "resumed":
      return "active";
    case "cancelled":
      return "cancelled";
    case "completed":
    case "paused":
      return "expired";
    default:
      return "pending";
  }
}

function parseUnixTs(value: unknown): string | null {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(raw * 1000).toISOString();
}

function parseTrialPurpose(purpose: string): string | null {
  const match = String(purpose || "").match(/^trial_activation_company_(.+)$/);
  if (!match) return null;
  const companyId = String(match[1] || "").trim();
  return companyId || null;
}

function mapAddonEntitlementToResource(key: string | null | undefined): string | null {
  switch (String(key || "").toLowerCase()) {
    case "unit":
      return "unit";
    case "box":
      return "box";
    case "carton":
      return "carton";
    case "pallet":
      return "pallet";
    case "seat":
      return "seats";
    case "plant":
      return "plants";
    case "handset":
      return "handsets";
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "webhook");
  const signature = headersList.get("x-razorpay-signature")?.trim() ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";

  if (!secret) {
    return withCorrelation({ error: "Webhook secret is not configured" }, 503, correlationId);
  }

  if (!signature) {
    return withCorrelation({ error: "Invalid signature" }, 401, correlationId);
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return withCorrelation({ error: "Empty payload" }, 400, correlationId);
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!timingSafeEqual(expectedSignature, signature)) {
    return withCorrelation({ error: "Invalid signature" }, 401, correlationId);
  }

  const limit = consumeRateLimit({
    key: "razorpay-webhook-global",
    refillPerMinute: 300,
    burst: 300,
  });
  if (!limit.allowed) {
    const response = withCorrelation({ error: "Rate limit exceeded" }, 429, correlationId);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return withCorrelation({ error: "Invalid JSON payload" }, 400, correlationId);
  }

  const supabase = getSupabaseAdmin();
  const eventId = deriveEventId(parsedBody, rawBody);
  const eventType =
    typeof parsedBody?.event === "string" && parsedBody.event.trim()
      ? parsedBody.event.trim()
      : "unknown";
  try {
    // Trial activation side effect (₹1 order) - idempotent and webhook-driven.
    // We do it here (app layer) to avoid coupling to DB RPC versions.
    if (eventType === "payment.captured") {
      const orderId = extractOrderId(parsedBody);
      const payment = extractPayment(parsedBody);
      if (orderId) {
        const { data: splitCheckoutSession } = await supabase
          .from("checkout_sessions")
          .select(
            "id, company_id, provider_subscription_id, provider_topup_order_id, selected_plan_template_id, selected_plan_version_id, quote_payload_json, totals_json, metadata"
          )
          .eq("provider_topup_order_id", orderId)
          .maybeSingle();

        if (
          splitCheckoutSession &&
          String((splitCheckoutSession as any)?.metadata?.billing_split || "") === "subscription_plus_addons"
        ) {
          if ((splitCheckoutSession as any)?.metadata?.addon_payment_processed_at) {
            return withCorrelation({ success: true, duplicate: true, addon_order: orderId }, 200, correlationId);
          }
          if (payment.id) {
            const { data: existingTopup } = await supabase
              .from("company_addon_topups")
              .select("id")
              .eq("provider", "razorpay")
              .eq("provider_payment_id", payment.id)
              .maybeSingle();

            if (existingTopup) {
              return withCorrelation({ success: true, duplicate: true, addon_order: orderId }, 200, correlationId);
            }
          }

          const companyId = String((splitCheckoutSession as any).company_id || "").trim();
          const nowIso = new Date().toISOString();
          const { data: currentSubscription } = await supabase
            .from("company_subscriptions")
            .select("current_period_end")
            .eq("company_id", companyId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const periodEndIso =
            String((currentSubscription as any)?.current_period_end || "").trim() ||
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          const codeAddons = Array.isArray((splitCheckoutSession as any)?.quote_payload_json?.code_addons)
            ? (splitCheckoutSession as any).quote_payload_json.code_addons
            : [];
          const capacityAddons = Array.isArray((splitCheckoutSession as any)?.quote_payload_json?.capacity_addons)
            ? (splitCheckoutSession as any).quote_payload_json.capacity_addons
            : [];

          await supabase
            .from("razorpay_orders")
            .update({
              status: "paid",
              paid_at: nowIso,
              payment_id: payment.id,
            })
            .eq("order_id", orderId);

          if (codeAddons.length) {
            const topupRows = codeAddons.map((line: any, index: number) => ({
              company_id: companyId,
              addon_id: line.addon_id,
              entitlement_key: line.entitlement_key,
              purchased_quantity: Math.max(
                Number(line.allocated_quota || 0),
                Number(line.quantity || 0),
                1
              ),
              consumed_quantity: 0,
              status: "paid",
              checkout_session_id: (splitCheckoutSession as any).id,
              provider: "razorpay",
              provider_order_id: orderId,
              provider_payment_id: `${payment.id || orderId}:${line.addon_id || index}:${index}`,
              amount: Math.max(0, Number(line.line_total_paise || 0) / 100),
              currency: "INR",
              metadata: {
                event_id: eventId,
                event_type: eventType,
                payment_id: payment.id,
              },
            }));

            await supabase.from("company_addon_topups").insert(topupRows);
          }

          if (capacityAddons.length) {
            const structuralRows = capacityAddons.map((line: any) => ({
              company_id: companyId,
              addon_id: line.addon_id,
              quantity: Math.max(1, Number(line.quantity || 1)),
              status: "active",
              checkout_session_id: (splitCheckoutSession as any).id,
              starts_at: nowIso,
              ends_at: periodEndIso,
              metadata: {
                event_id: eventId,
                event_type: eventType,
                payment_id: payment.id,
                order_id: orderId,
                billing_split: "subscription_plus_addons",
              },
            }));

            await supabase.from("company_addon_subscriptions").insert(structuralRows);
          }

          const allocationRows = [...codeAddons, ...capacityAddons]
            .map((line: any) => {
              const resource = mapAddonEntitlementToResource(line.entitlement_key);
              const amount =
                resource === "seats" || resource === "plants" || resource === "handsets"
                  ? Math.max(0, Math.trunc(Number(line.allocated_capacity || line.quantity || 0)))
                  : Math.max(0, Math.trunc(Number(line.allocated_quota || line.quantity || 0)));
              if (!resource || amount <= 0) return null;
              return {
                company_id: companyId,
                source: "addon",
                quota_type: resource === "seats" || resource === "plants" || resource === "handsets" ? "base" : "variable",
                resource,
                amount,
                expires_at: periodEndIso,
                metadata: {
                  event_id: eventId,
                  event_type: eventType,
                  payment_id: payment.id,
                  order_id: orderId,
                  checkout_session_id: (splitCheckoutSession as any).id,
                },
              };
            })
            .filter(Boolean);

          if (allocationRows.length) {
            await supabase.from("quota_allocations").insert(allocationRows as any[]);
          }

          await supabase.from("billing_invoices").insert({
            company_id: companyId,
            invoice_type: "addon_topup",
            status: "paid",
            provider: "razorpay",
            provider_payment_id: payment.id || orderId,
            checkout_session_id: (splitCheckoutSession as any).id,
            amount: Math.max(0, Number((splitCheckoutSession as any)?.totals_json?.addons_payable_paise || 0) / 100),
            discount_amount: Math.max(0, Number((splitCheckoutSession as any)?.totals_json?.discount_paise || 0) / 100),
            currency: "INR",
            issued_at: nowIso,
            paid_at: nowIso,
            metadata: {
              event_id: eventId,
              event_type: eventType,
              order_id: orderId,
              payment_id: payment.id,
            },
            updated_at: nowIso,
          });

          await supabase
            .from("checkout_sessions")
            .update({
              status: "completed",
              completed_at: nowIso,
              metadata: {
                ...((splitCheckoutSession as any).metadata || {}),
                addon_payment_processed_at: nowIso,
                addon_payment_id: payment.id,
                addon_order_id: orderId,
              },
              updated_at: nowIso,
            })
            .eq("id", (splitCheckoutSession as any).id);

          return withCorrelation(
            {
              success: true,
              addon_order_processed: true,
              order_id: orderId,
              payment_id: payment.id,
            },
            200,
            correlationId
          );
        }

        const { data: orderRow } = await supabase
          .from("razorpay_orders")
          .select("order_id, purpose, payment_id, status, amount_paise")
          .eq("order_id", orderId)
          .maybeSingle();

        const companyId = orderRow?.purpose ? parseTrialPurpose(String((orderRow as any).purpose)) : null;
        if (companyId) {
          const purposeMatches = Boolean(orderRow?.purpose && parseTrialPurpose(String(orderRow.purpose)) === companyId);
          const paymentCaptured = payment.status === "captured";
          const orderAmountPaise = Number((orderRow as any)?.amount_paise ?? 0);
          const amountMatches = orderAmountPaise === 100 && payment.amount === 100;

          if (!purposeMatches || !paymentCaptured || !amountMatches) {
            logWithContext("info", "Trial activation validation failed; skipping activation", {
              correlationId,
              route: "/api/razorpay/webhook",
              eventId,
              eventType,
              orderId,
              companyId,
              purposeMatches,
              paymentCaptured,
              orderAmountPaise,
              paymentAmountPaise: payment.amount,
            });
          } else {
          // One trial per company: activate only if no trial window exists.
          const { data: trialRow } = await supabase
            .from("company_trials")
            .select("trial_start, trial_end")
            .eq("company_id", companyId)
            .maybeSingle();

          const alreadyActivated =
            Boolean((trialRow as any)?.trial_start) ||
            Boolean((trialRow as any)?.trial_end);

          if (!alreadyActivated) {
            const now = new Date();
            const end = new Date(now);
            end.setUTCDate(end.getUTCDate() + 10);

            const { error: trialInsertErr } = await supabase
              .from("company_trials")
              .upsert(
                {
                  company_id: companyId,
                  trial_start: now.toISOString(),
                  trial_end: end.toISOString(),
                  status: 'active',
                  created_at: now.toISOString(),
                  updated_at: now.toISOString(),
                },
                { onConflict: "company_id" }
              );

            if (!trialInsertErr) {
              // Policy A: trial starts with a clean quota slate for this trial window.
              const periodStart = now.toISOString().slice(0, 10); // YYYY-MM-DD
              const periodEnd = end.toISOString().slice(0, 10); // YYYY-MM-DD
              const counters = ["UNIT", "BOX", "CARTON", "SSCC"].map((metricType) => ({
                company_id: companyId,
                metric_type: metricType,
                period_start: periodStart,
                period_end: periodEnd,
                used_quantity: 0,
                updated_at: now.toISOString(),
              }));

              await supabase.from("usage_counters").upsert(counters, {
                onConflict: "company_id,metric_type,period_start",
              });
            }
          }
          }
        }
      }
    }

    const { data, error } = await supabase.rpc("process_razorpay_webhook_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payload: parsedBody,
      p_correlation_id: correlationId,
    });

    if (error) {
      logWithContext("error", "Atomic webhook processing RPC failed", {
        correlationId,
        route: "/api/razorpay/webhook",
        method: "POST",
        eventId,
        eventType,
        error: error.message,
      });
      return withCorrelation({ error: "Webhook processing failed" }, 500, correlationId);
    }

    const result = (data || {}) as Record<string, unknown>;
    const duplicate = Boolean((result as any).duplicate);
    if (duplicate) {
      return withCorrelation({ success: true, duplicate: true }, 200, correlationId);
    }

    if (eventType.startsWith("subscription.")) {
      const subscriptionEntity = parsedBody?.payload?.subscription?.entity ?? null;
      const subscriptionId = String(subscriptionEntity?.id || "").trim();
      if (subscriptionId) {
        const derivedStatus = deriveSubscriptionStatus(eventType);
        const periodStart =
          parseUnixTs(subscriptionEntity?.current_start) ||
          parseUnixTs(subscriptionEntity?.current_period_start);
        const periodEnd =
          parseUnixTs(subscriptionEntity?.current_end) ||
          parseUnixTs(subscriptionEntity?.current_period_end);

        const { data: linkedSession } = await supabase
          .from("checkout_sessions")
          .select("id, company_id, selected_plan_template_id, selected_plan_version_id, quote_payload_json")
          .eq("provider_subscription_id", subscriptionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const companyId = String((linkedSession as any)?.company_id || "").trim();
        if (companyId) {
          const billingCycle = String(
            (linkedSession as any)?.quote_payload_json?.plan?.billing_cycle || "monthly"
          ).toLowerCase() === "yearly"
            ? "yearly"
            : "monthly";
          const periodStartIso = periodStart || new Date().toISOString();
          const defaultEnd = new Date(periodStartIso);
          defaultEnd.setUTCMonth(defaultEnd.getUTCMonth() + (billingCycle === "yearly" ? 12 : 1));
          const periodEndIso = periodEnd || defaultEnd.toISOString();

          const { data: existingSub } = await supabase
            .from("company_subscriptions")
            .select("id, activated_at")
            .eq("company_id", companyId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const subscriptionPayload = {
            company_id: companyId,
            status: derivedStatus,
            plan_template_id: (linkedSession as any)?.selected_plan_template_id || null,
            plan_version_id: (linkedSession as any)?.selected_plan_version_id || null,
            razorpay_subscription_id: subscriptionId,
            current_period_start: periodStartIso,
            current_period_end: periodEndIso,
            next_billing_at: periodEndIso,
            renewal_date: periodEndIso,
            start_date: periodStartIso,
            activated_at:
              derivedStatus === "active"
                ? (existingSub as any)?.activated_at || new Date().toISOString()
                : (existingSub as any)?.activated_at || null,
            updated_at: new Date().toISOString(),
            metadata: {
              webhook_source: "razorpay",
              last_subscription_event: eventType,
              last_subscription_event_id: eventId,
            },
          };

          if ((existingSub as any)?.id) {
            await supabase
              .from("company_subscriptions")
              .update(subscriptionPayload)
              .eq("id", (existingSub as any).id);
          } else {
            await supabase.from("company_subscriptions").insert(subscriptionPayload);
          }

          if (derivedStatus === "active") {
            await supabase.rpc("apply_cycle_reset", {
              p_company_id: companyId,
              p_new_period_start: periodStartIso,
              p_new_period_end: periodEndIso,
            });

            // Best-effort ledger initialization for quota-based entitlement snapshots.
            // Kept non-fatal to avoid blocking webhook acknowledgements on schema drift.
            try {
              await supabase
                .from("quota_allocations")
                .delete()
                .eq("company_id", companyId)
                .eq("source", "subscription")
                .eq("quota_type", "base");

              const quotePlan = (linkedSession as any)?.quote_payload_json?.plan || {};
              const quotaRows = [
                { resource: "unit", amount: Number(quotePlan?.quotas?.unit || 0) },
                { resource: "box", amount: Number(quotePlan?.quotas?.box || 0) },
                { resource: "carton", amount: Number(quotePlan?.quotas?.carton || 0) },
                { resource: "pallet", amount: Number(quotePlan?.quotas?.pallet || 0) },
                { resource: "seats", amount: Number(quotePlan?.capacities?.seat || 0) },
                { resource: "plants", amount: Number(quotePlan?.capacities?.plant || 0) },
                { resource: "handsets", amount: Number(quotePlan?.capacities?.handset || 0) },
              ]
                .map((row) => ({ ...row, amount: Number.isFinite(row.amount) ? Math.max(0, Math.trunc(row.amount)) : 0 }))
                .filter((row) => row.amount > 0)
                .map((row) => ({
                  company_id: companyId,
                  source: "subscription",
                  quota_type: "base",
                  resource: row.resource,
                  amount: row.amount,
                  expires_at: periodEndIso,
                  metadata: {
                    razorpay_subscription_id: subscriptionId,
                    checkout_session_id: (linkedSession as any)?.id || null,
                    period_start: periodStartIso,
                    period_end: periodEndIso,
                  },
                }));

              if (quotaRows.length) {
                await supabase.from("quota_allocations").insert(quotaRows);
              }
            } catch (allocationError: any) {
              logWithContext("warn", "Failed to initialize quota_allocations from subscription activation", {
                correlationId,
                route: "/api/razorpay/webhook",
                eventId,
                eventType,
                companyId,
                subscriptionId,
                error: allocationError?.message || String(allocationError),
              });
            }
          }
        }
      }
    }

    return withCorrelation(result, 200, correlationId);
  } catch (error: any) {
    logWithContext("error", "Webhook processing failed", {
      correlationId,
      route: "/api/razorpay/webhook",
      method: "POST",
      eventId,
      eventType,
      error: error?.message ?? String(error),
    });

    return withCorrelation({ error: "Webhook processing failed" }, 500, correlationId);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Razorpay from "razorpay";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getOrGenerateCorrelationId } from "@/lib/observability/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRazorpayClient(keyId: string, keySecret: string) {
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function toPaise(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

export async function POST(req: NextRequest) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  try {
    const correlationId = getOrGenerateCorrelationId(await headers(), "user");
    const body = await req.json().catch(() => ({}));
    const quoteId = String((body as any)?.quote_id || "").trim();
    if (!quoteId) {
      return NextResponse.json({ error: "quote_id is required" }, { status: 400 });
    }

    const { data: quote, error: quoteError } = await owner.supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .eq("company_id", owner.companyId)
      .eq("user_id", owner.userId)
      .maybeSingle();
    if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 });
    if (!quote) return NextResponse.json({ error: "QUOTE_NOT_FOUND" }, { status: 404 });

    const quoteStatus = String((quote as any).status || "").trim().toLowerCase();
    if (quoteStatus !== "active") {
      return NextResponse.json({ error: "QUOTE_NOT_ACTIVE" }, { status: 409 });
    }

    const expiresAt = new Date(String((quote as any).expires_at || "")).getTime();
    if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
      await owner.supabase.from("quotes").update({ status: "expired" }).eq("id", quoteId);
      return NextResponse.json({ error: "QUOTE_EXPIRED" }, { status: 409 });
    }

    const totalsSnapshot = ((quote as any).totals_snapshot_json || {}) as Record<string, unknown>;
    const planSnapshot = ((quote as any).plan_snapshot_json || {}) as Record<string, unknown>;
    const hasPlan = Object.keys(planSnapshot).length > 0;
    const finalAmountPaise = toPaise(totalsSnapshot.final_total_paise);
    if (!finalAmountPaise) {
      return NextResponse.json({ error: "QUOTE_FINAL_TOTAL_MISSING" }, { status: 409 });
    }
    if (finalAmountPaise <= 0) {
      return NextResponse.json({ error: "FINAL_TOTAL_MUST_BE_GREATER_THAN_ZERO" }, { status: 400 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
    }

    const { data: existingIntent, error: intentReadError } = await owner.supabase
      .from("payment_intents")
      .select("*")
      .eq("quote_id", quoteId)
      .maybeSingle();
    if (intentReadError) return NextResponse.json({ error: intentReadError.message }, { status: 500 });

    if (existingIntent && String((existingIntent as any).razorpay_order_id || "").trim()) {
      if (hasPlan) {
        const { data: existingSub } = await owner.supabase
          .from("company_subscriptions")
          .select("id, status")
          .eq("company_id", owner.companyId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if ((existingSub as any)?.id) {
          const currentStatus = String((existingSub as any).status || "").trim().toLowerCase();
          if (!["active", "pending_payment"].includes(currentStatus)) {
            await owner.supabase
              .from("company_subscriptions")
              .update({
                status: "pending_payment",
                plan_template_id: (quote as any).plan_id || null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", (existingSub as any).id);
          }
        } else {
          await owner.supabase.from("company_subscriptions").insert({
            company_id: owner.companyId,
            status: "pending_payment",
            plan_template_id: (quote as any).plan_id || null,
            metadata: { quote_id: quoteId, initiated_from: "payment_initiate_replay" },
          });
        }
      }

      await owner.supabase
        .from("quotes")
        .update({ status: "pending_payment" })
        .eq("id", quoteId)
        .eq("status", "active");
      return NextResponse.json({
        success: true,
        replay: true,
        quote_id: quoteId,
        payment_intent_id: (existingIntent as any).id,
        order_id: (existingIntent as any).razorpay_order_id,
        correlation_id: correlationId,
        razorpay: {
          key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || keyId || null,
          order_id: (existingIntent as any).razorpay_order_id,
          amount_paise: finalAmountPaise,
          currency: String((quote as any).currency || "INR"),
        },
      });
    }

    const razorpay = getRazorpayClient(keyId, keySecret);
    const createdOrder = await razorpay.orders.create({
      amount: finalAmountPaise,
      currency: String((quote as any).currency || "INR"),
      receipt: `quote_${quoteId.slice(0, 8)}_${Date.now()}`,
      notes: {
        quote_id: quoteId,
        company_id: owner.companyId,
        user_id: owner.userId,
        correlation_id: correlationId,
        final_total_paise: String(finalAmountPaise),
      },
    });
    const orderId = String(createdOrder?.id || "").trim();
    if (!orderId) {
      return NextResponse.json({ error: "RAZORPAY_ORDER_CREATE_FAILED" }, { status: 502 });
    }

    const payload = {
      quote_id: quoteId,
      razorpay_order_id: orderId,
      amount_paise: finalAmountPaise,
      correlation_id: correlationId,
      status: "created",
      updated_at: new Date().toISOString(),
    };

    const { data: savedIntent, error: upsertError } = await owner.supabase
      .from("payment_intents")
      .upsert(payload, { onConflict: "quote_id" })
      .select("id, razorpay_order_id")
      .single();
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

    await owner.supabase
      .from("quotes")
      .update({ status: "pending_payment" })
      .eq("id", quoteId)
      .eq("status", "active");

    if (hasPlan) {
      const { data: existingSub } = await owner.supabase
        .from("company_subscriptions")
        .select("id, status")
        .eq("company_id", owner.companyId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if ((existingSub as any)?.id) {
        const currentStatus = String((existingSub as any).status || "").trim().toLowerCase();
        if (!["active", "pending_payment"].includes(currentStatus)) {
          await owner.supabase
            .from("company_subscriptions")
            .update({
              status: "pending_payment",
              plan_template_id: (quote as any).plan_id || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (existingSub as any).id);
        }
      } else {
        await owner.supabase.from("company_subscriptions").insert({
          company_id: owner.companyId,
          status: "pending_payment",
          plan_template_id: (quote as any).plan_id || null,
          metadata: { quote_id: quoteId, initiated_from: "payment_initiate" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      quote_id: quoteId,
      payment_intent_id: (savedIntent as any).id,
      order_id: (savedIntent as any).razorpay_order_id,
      correlation_id: correlationId,
      razorpay: {
        key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || keyId || null,
        order_id: (savedIntent as any).razorpay_order_id,
        amount_paise: finalAmountPaise,
        currency: String((quote as any).currency || "INR"),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to initiate Razorpay checkout payment" },
      { status: 500 }
    );
  }
}

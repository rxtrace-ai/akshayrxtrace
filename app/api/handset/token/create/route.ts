import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { getCompanyUserContext, insertHandsetLog } from "@/lib/handset-v2/db";
import {
  deriveTokenStatus,
  generateActivationToken,
  getDefaultMaxActivations,
  getMaxTokenExpiryHours,
  hashActivationToken,
  isHandsetV2Enabled,
  redactToken,
} from "@/lib/handset-v2/config";

export async function POST(req: Request) {
  if (!isHandsetV2Enabled()) {
    return NextResponse.json({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ctx = await getCompanyUserContext();
  if (!ctx.ok) {
    return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  }

  const perUser = consumeRateLimit({
    key: `handset-v2:create:user:${ctx.userId}`,
    refillPerMinute: 6,
    burst: 6,
  });
  const perCompany = consumeRateLimit({
    key: `handset-v2:create:company:${ctx.companyId}`,
    refillPerMinute: 20,
    burst: 20,
  });

  if (!perUser.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: perUser.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!perCompany.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: perCompany.retryAfterSeconds },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      expiry_hours?: number;
      max_activations?: number;
      intended_user?: string | null;
    };

    const maxExpiryHours = getMaxTokenExpiryHours();
    const requestedExpiry = Number(body.expiry_hours || maxExpiryHours);
    const expiryHours = Math.max(1, Math.min(maxExpiryHours, Math.floor(requestedExpiry)));

    const defaultMaxActivations = getDefaultMaxActivations();
    const requestedActivations = Number(body.max_activations || defaultMaxActivations);
    const maxActivations = Math.max(1, Math.min(defaultMaxActivations, Math.floor(requestedActivations)));

    const plainToken = generateActivationToken();
    const tokenHash = hashActivationToken(plainToken);

    const { data: row, error } = await ctx.supabase
      .from("handset_activation_tokens")
      .insert({
        company_id: ctx.companyId,
        token_hash: tokenHash,
        created_by: ctx.userId,
        intended_user: body.intended_user ? String(body.intended_user).slice(0, 255) : null,
        max_activations: maxActivations,
        expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
      })
      .select("id, company_id, created_at, expires_at, max_activations, activation_count, revoked_at")
      .single();

    if (error || !row) {
      return NextResponse.json({ success: false, error: error?.message || "TOKEN_CREATE_FAILED" }, { status: 500 });
    }

    await insertHandsetLog({
      supabase: ctx.supabase,
      companyId: ctx.companyId,
      createdBy: ctx.userId,
      eventType: "token_created",
      metadata: {
        token_id: row.id,
        max_activations: row.max_activations,
        expires_at: row.expires_at,
      },
    });

    return NextResponse.json({
      success: true,
      token: plainToken,
      token_id: row.id,
      token_status: deriveTokenStatus(row),
      expires_at: row.expires_at,
      max_activations: row.max_activations,
      activation_count: row.activation_count,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: redactToken(String(err?.message || "TOKEN_CREATE_FAILED")) },
      { status: 500 }
    );
  }
}

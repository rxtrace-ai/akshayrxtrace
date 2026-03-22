import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { signDeviceAuthToken } from "@/lib/handset-v2/auth";
import { isHandsetV2Enabled, normalizeActivationToken, hashActivationToken, redactToken, safeIpFromRequest } from "@/lib/handset-v2/config";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function activateHandsetFallback(params: {
  supabase: any;
  tokenHash: string;
  deviceId: string;
  platform: string;
  appVersion: string;
  deviceName: string;
}) {
  const { supabase, tokenHash, deviceId, platform, appVersion, deviceName } = params;

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("handset_activation_tokens")
    .select("id, company_id, activation_count, max_activations, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenErr) throw new Error(`FALLBACK_TOKEN_QUERY_FAILED:${String(tokenErr.message || tokenErr)}`);
  if (!tokenRow) throw new Error("TOKEN_NOT_FOUND");
  if (tokenRow.revoked_at) throw new Error("TOKEN_REVOKED");
  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) throw new Error("TOKEN_EXPIRED");

  const activationCount = Number(tokenRow.activation_count || 0);
  const maxActivations = Number(tokenRow.max_activations || 0);
  if (activationCount >= maxActivations) throw new Error("TOKEN_EXHAUSTED");

  const { error: incErr } = await supabase
    .from("handset_activation_tokens")
    .update({ activation_count: activationCount + 1 })
    .eq("id", tokenRow.id);
  if (incErr) throw new Error(`FALLBACK_TOKEN_UPDATE_FAILED:${String(incErr.message || incErr)}`);

  const normalizedPlatform = String(platform || "android").toLowerCase();
  const normalizedAppVersion = String(appVersion || "").trim() || null;
  const normalizedDeviceName = String(deviceName || "").trim() || null;

  let handsetId = "";
  const { data: existing, error: existingErr } = await supabase
    .from("handsets")
    .select("id")
    .eq("company_id", tokenRow.company_id)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (existingErr) throw new Error(`FALLBACK_HANDSET_QUERY_FAILED:${String(existingErr.message || existingErr)}`);

  if (existing?.id) {
    const { data: updated, error: updErr } = await supabase
      .from("handsets")
      .update({
        status: "ACTIVE",
        platform: normalizedPlatform,
        app_version: normalizedAppVersion,
        device_name: normalizedDeviceName,
        activated_at: new Date().toISOString(),
        disabled_by: null,
        disabled_at: null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updErr) throw new Error(`FALLBACK_HANDSET_UPDATE_FAILED:${String(updErr.message || updErr)}`);
    handsetId = String(updated?.id || existing.id);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("handsets")
      .insert({
        company_id: tokenRow.company_id,
        status: "ACTIVE",
        device_id: deviceId,
        platform: normalizedPlatform,
        app_version: normalizedAppVersion,
        device_name: normalizedDeviceName,
        activated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`FALLBACK_HANDSET_INSERT_FAILED:${String(insErr.message || insErr)}`);
    handsetId = String(inserted?.id || "");
  }

  await supabase.from("handset_logs").insert({
    company_id: tokenRow.company_id,
    handset_id: handsetId || null,
    event_type: "token_activated",
    metadata: {
      token_id: tokenRow.id,
      activation_count: activationCount + 1,
      max_activations: maxActivations,
      device_id: deviceId,
      platform: normalizedPlatform,
      source: "api_fallback",
    },
    created_by: null,
  }).then(() => undefined).catch(() => undefined);

  return {
    token_id: String(tokenRow.id),
    company_id: String(tokenRow.company_id),
    handset_id: handsetId,
    activation_count: activationCount + 1,
    max_activations: maxActivations,
    expires_at: String(tokenRow.expires_at),
  };
}

export async function POST(req: Request) {
  if (!isHandsetV2Enabled()) {
    return apiJson({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const ip = safeIpFromRequest(req);
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    device_id?: string;
    platform?: string;
    app_version?: string;
    device_name?: string;
  };

  const token = normalizeActivationToken(body.token || "");
  const deviceId = String(body.device_id || "").trim();
  const platform = String(body.platform || "").trim().toLowerCase();
  const appVersion = String(body.app_version || "").trim();
  const deviceName = String(body.device_name || "").trim();

  if (!token || !/^RX-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(token)) {
    return apiJson({ success: false, error: "INVALID_TOKEN" }, { status: 400 });
  }
  if (!UUID_V4_REGEX.test(deviceId)) {
    return apiJson({ success: false, error: "INVALID_DEVICE_ID" }, { status: 400 });
  }
  if (platform !== "android") {
    return apiJson({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });
  }

  const ipLimit = await consumeRateLimit({ key: `handset-v2:activate:ip:${ip}`, refillPerMinute: 20, burst: 20 });
  const deviceLimit = await consumeRateLimit({ key: `handset-v2:activate:device:${deviceId}`, refillPerMinute: 10, burst: 10 });
  const tokenLimit = await consumeRateLimit({ key: `handset-v2:activate:token:${hashActivationToken(token)}`, refillPerMinute: 30, burst: 30 });

  if (!ipLimit.allowed) {
    return apiJson(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: ipLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!deviceLimit.allowed) {
    return apiJson(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: deviceLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!tokenLimit.allowed) {
    return apiJson(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: tokenLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  const supabase = getSupabaseAdmin();
  try {
    const tokenHash = hashActivationToken(token);
    const { data, error } = await supabase.rpc("activate_handset_v2", {
      p_token_hash: tokenHash,
      p_device_id: deviceId,
      p_platform: platform,
      p_app_version: appVersion || null,
      p_device_name: deviceName || null,
      p_actor_user_id: null,
    });

    let row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.handset_id || !row?.company_id) {
      const msg = String(error?.message || "ACTIVATION_FAILED");
      const mapped = msg.includes("TOKEN_EXPIRED")
        ? "TOKEN_EXPIRED"
        : msg.includes("TOKEN_REVOKED")
        ? "TOKEN_REVOKED"
        : msg.includes("TOKEN_EXHAUSTED")
        ? "TOKEN_EXHAUSTED"
        : msg.includes("INVALID_TOKEN")
        ? "INVALID_TOKEN"
        : msg.includes("TOKEN_NOT_FOUND")
        ? "INVALID_TOKEN"
        : "";

      if (mapped) {
        return apiJson({ success: false, error: mapped }, { status: 400 });
      }

      // Fallback path: handles environments where RPC is unavailable/misaligned.
      try {
        row = await activateHandsetFallback({
          supabase,
          tokenHash,
          deviceId,
          platform,
          appVersion,
          deviceName,
        });
      } catch (fallbackErr: any) {
        const fallbackMsg = String(fallbackErr?.message || "ACTIVATION_FAILED");
        const fallbackMapped = fallbackMsg.includes("TOKEN_EXPIRED")
          ? "TOKEN_EXPIRED"
          : fallbackMsg.includes("TOKEN_REVOKED")
          ? "TOKEN_REVOKED"
          : fallbackMsg.includes("TOKEN_EXHAUSTED")
          ? "TOKEN_EXHAUSTED"
          : fallbackMsg.includes("TOKEN_NOT_FOUND")
          ? "INVALID_TOKEN"
          : fallbackMsg.includes("INVALID_TOKEN")
          ? "INVALID_TOKEN"
          : "ACTIVATION_FAILED";
        return apiJson(
          { success: false, error: fallbackMapped, detail: redactToken(fallbackMsg) },
          { status: fallbackMapped === "ACTIVATION_FAILED" ? 500 : 400 }
        );
      }
    }

    const deviceAuthToken = signDeviceAuthToken({
      handsetId: String(row.handset_id),
      companyId: String(row.company_id),
      deviceId,
    });

    return apiJson({
      success: true,
      handset_id: String(row.handset_id),
      device_auth_token: deviceAuthToken,
      token_state: {
        activation_count: Number(row.activation_count || 0),
        max_activations: Number(row.max_activations || 0),
        status:
          Number(row.activation_count || 0) >= Number(row.max_activations || 0)
            ? "exhausted"
            : Number(row.activation_count || 0) > 0
            ? "active"
            : "issued",
      },
    });
  } catch (err: any) {
    return apiJson(
      { success: false, error: redactToken(String(err?.message || "ACTIVATION_FAILED")) },
      { status: 500 }
    );
  }
}



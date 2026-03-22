import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { signDeviceAuthToken } from "@/lib/handset-v2/auth";
import { isHandsetV2Enabled, normalizeActivationToken, hashActivationToken, redactToken, safeIpFromRequest } from "@/lib/handset-v2/config";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ActivationErrorCode =
  | "FEATURE_DISABLED"
  | "INVALID_TOKEN"
  | "INVALID_DEVICE_ID"
  | "INVALID_PLATFORM"
  | "RATE_LIMITED"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "TOKEN_EXHAUSTED"
  | "ACTIVATION_FAILED"
  | "SECRET_MISSING";

function activationMessage(code: ActivationErrorCode): string {
  switch (code) {
    case "FEATURE_DISABLED":
      return "Handset activation is disabled.";
    case "INVALID_TOKEN":
      return "Activation token is invalid.";
    case "INVALID_DEVICE_ID":
      return "Device ID must be a valid UUID v4.";
    case "INVALID_PLATFORM":
      return "Unsupported platform. Android is required.";
    case "RATE_LIMITED":
      return "Too many requests. Please retry shortly.";
    case "TOKEN_EXPIRED":
      return "Activation token has expired.";
    case "TOKEN_REVOKED":
      return "Activation token has been revoked.";
    case "TOKEN_EXHAUSTED":
      return "Activation token has reached max activations.";
    case "SECRET_MISSING":
      return "Server configuration missing signing secret.";
    default:
      return "Handset activation failed.";
  }
}

function activationStatus(code: ActivationErrorCode): number {
  if (code === "RATE_LIMITED") return 429;
  if (code === "ACTIVATION_FAILED" || code === "SECRET_MISSING") return 500;
  if (code === "FEATURE_DISABLED") return 403;
  return 400;
}

function activationError(code: ActivationErrorCode, detail?: string, extra?: Record<string, unknown>) {
  const payload = {
    success: false,
    error: {
      code,
      message: activationMessage(code),
      ...(detail ? { detail } : {}),
      ...(extra || {}),
    },
  };
  return apiJson(payload, { status: activationStatus(code) });
}

function inferActivationCode(input: unknown): ActivationErrorCode | null {
  const text = String(input || "").toUpperCase();
  if (!text) return null;
  if (text.includes("TOKEN_EXPIRED")) return "TOKEN_EXPIRED";
  if (text.includes("TOKEN_REVOKED")) return "TOKEN_REVOKED";
  if (text.includes("TOKEN_EXHAUSTED")) return "TOKEN_EXHAUSTED";
  if (text.includes("TOKEN_NOT_FOUND")) return "INVALID_TOKEN";
  if (text.includes("INVALID_TOKEN")) return "INVALID_TOKEN";
  if (text.includes("INVALID_DEVICE_ID")) return "INVALID_DEVICE_ID";
  if (text.includes("INVALID_PLATFORM")) return "INVALID_PLATFORM";
  if (text.includes("RATE_LIMITED")) return "RATE_LIMITED";
  return null;
}

function logActivation(event: string, meta: Record<string, unknown>) {
  console.info(`[handset.activate] ${event}`, meta);
}

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
    logActivation("feature_disabled", {});
    return activationError("FEATURE_DISABLED");
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
    logActivation("invalid_token_format", { token_present: Boolean(token) });
    return activationError("INVALID_TOKEN");
  }
  if (!UUID_V4_REGEX.test(deviceId)) {
    logActivation("invalid_device_id", { deviceId });
    return activationError("INVALID_DEVICE_ID");
  }
  if (platform !== "android") {
    logActivation("invalid_platform", { platform });
    return activationError("INVALID_PLATFORM");
  }

  const ipLimit = await consumeRateLimit({ key: `handset-v2:activate:ip:${ip}`, refillPerMinute: 20, burst: 20 });
  const deviceLimit = await consumeRateLimit({ key: `handset-v2:activate:device:${deviceId}`, refillPerMinute: 10, burst: 10 });
  const tokenLimit = await consumeRateLimit({ key: `handset-v2:activate:token:${hashActivationToken(token)}`, refillPerMinute: 30, burst: 30 });

  if (!ipLimit.allowed) {
    logActivation("rate_limited_ip", { ip, retry_after_seconds: ipLimit.retryAfterSeconds });
    return activationError("RATE_LIMITED", undefined, { retry_after_seconds: ipLimit.retryAfterSeconds });
  }

  if (!deviceLimit.allowed) {
    logActivation("rate_limited_device", { deviceId, retry_after_seconds: deviceLimit.retryAfterSeconds });
    return activationError("RATE_LIMITED", undefined, { retry_after_seconds: deviceLimit.retryAfterSeconds });
  }

  if (!tokenLimit.allowed) {
    logActivation("rate_limited_token", { token: redactToken(token), retry_after_seconds: tokenLimit.retryAfterSeconds });
    return activationError("RATE_LIMITED", undefined, { retry_after_seconds: tokenLimit.retryAfterSeconds });
  }

  const supabase = getSupabaseAdmin();
  try {
    const tokenHash = hashActivationToken(token);
    logActivation("activation_attempt", {
      token: redactToken(token),
      device_id: deviceId,
      platform,
      app_version: appVersion || null,
      device_name: deviceName || null,
      ip,
    });
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
      if (error) {
        logActivation("rpc_error", {
          token: redactToken(token),
          code: (error as any)?.code || null,
          message: (error as any)?.message || null,
          details: (error as any)?.details || null,
          hint: (error as any)?.hint || null,
        });
      } else {
        logActivation("rpc_empty_row", { token: redactToken(token), rpc_data: row || null });
      }

      const mapped =
        inferActivationCode((error as any)?.message) ||
        inferActivationCode((error as any)?.code) ||
        inferActivationCode((error as any)?.details) ||
        inferActivationCode((error as any)?.hint);

      if (mapped) {
        return activationError(mapped, redactToken(String((error as any)?.message || mapped)));
      }

      // Fallback path: handles environments where RPC is unavailable/misaligned.
      try {
        logActivation("fallback_start", { token: redactToken(token), device_id: deviceId });
        row = await activateHandsetFallback({
          supabase,
          tokenHash,
          deviceId,
          platform,
          appVersion,
          deviceName,
        });
        logActivation("fallback_success", {
          token: redactToken(token),
          handset_id: row?.handset_id || null,
          company_id: row?.company_id || null,
          activation_count: row?.activation_count || null,
        });
      } catch (fallbackErr: any) {
        const fallbackMsg = String(fallbackErr?.message || "ACTIVATION_FAILED");
        logActivation("fallback_error", {
          token: redactToken(token),
          detail: redactToken(fallbackMsg),
        });
        const fallbackMapped = inferActivationCode(fallbackMsg) || "ACTIVATION_FAILED";
        return activationError(fallbackMapped, redactToken(fallbackMsg));
      }
    }

    let deviceAuthToken = "";
    try {
      deviceAuthToken = signDeviceAuthToken({
        handsetId: String(row.handset_id),
        companyId: String(row.company_id),
        deviceId,
      });
    } catch (signErr: any) {
      const signMsg = String(signErr?.message || "ACTIVATION_FAILED");
      logActivation("token_sign_error", { detail: redactToken(signMsg) });
      if (signMsg.includes("HANDSET_DEVICE_AUTH_SECRET")) {
        return activationError("SECRET_MISSING", redactToken(signMsg));
      }
      return activationError("ACTIVATION_FAILED", redactToken(signMsg));
    }

    logActivation("activation_success", {
      token: redactToken(token),
      handset_id: String(row.handset_id),
      company_id: String(row.company_id),
      activation_count: Number(row.activation_count || 0),
      max_activations: Number(row.max_activations || 0),
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
    const msg = redactToken(String(err?.message || "ACTIVATION_FAILED"));
    logActivation("activation_exception", { detail: msg });
    return activationError("ACTIVATION_FAILED", msg);
  }
}



import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { signDeviceAuthToken } from "@/lib/handset-v2/auth";
import { isHandsetV2Enabled, normalizeActivationToken, hashActivationToken, redactToken, safeIpFromRequest } from "@/lib/handset-v2/config";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!isHandsetV2Enabled()) {
    return NextResponse.json({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
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
    return NextResponse.json({ success: false, error: "INVALID_TOKEN" }, { status: 400 });
  }
  if (!UUID_V4_REGEX.test(deviceId)) {
    return NextResponse.json({ success: false, error: "INVALID_DEVICE_ID" }, { status: 400 });
  }
  if (platform !== "android") {
    return NextResponse.json({ success: false, error: "INVALID_PLATFORM" }, { status: 400 });
  }

  const ipLimit = consumeRateLimit({ key: `handset-v2:activate:ip:${ip}`, refillPerMinute: 20, burst: 20 });
  const deviceLimit = consumeRateLimit({ key: `handset-v2:activate:device:${deviceId}`, refillPerMinute: 10, burst: 10 });
  const tokenLimit = consumeRateLimit({ key: `handset-v2:activate:token:${hashActivationToken(token)}`, refillPerMinute: 30, burst: 30 });

  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: ipLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!deviceLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "RATE_LIMITED", retry_after_seconds: deviceLimit.retryAfterSeconds },
      { status: 429 }
    );
  }

  if (!tokenLimit.allowed) {
    return NextResponse.json(
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

    if (error) {
      const msg = String(error.message || "ACTIVATION_FAILED");
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
        : "ACTIVATION_FAILED";
      return NextResponse.json({ success: false, error: mapped }, { status: mapped === "ACTIVATION_FAILED" ? 500 : 400 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.handset_id || !row?.company_id) {
      return NextResponse.json({ success: false, error: "ACTIVATION_FAILED" }, { status: 500 });
    }

    const deviceAuthToken = signDeviceAuthToken({
      handsetId: String(row.handset_id),
      companyId: String(row.company_id),
      deviceId,
    });

    return NextResponse.json({
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
    return NextResponse.json(
      { success: false, error: redactToken(String(err?.message || "ACTIVATION_FAILED")) },
      { status: 500 }
    );
  }
}

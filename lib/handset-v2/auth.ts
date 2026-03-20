import jwt, { JwtPayload } from "jsonwebtoken";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getDeviceAuthSecret, getDeviceAuthTtlSeconds } from "./config";

export type DeviceAuthClaims = {
  sub: string;
  company_id: string;
  device_id: string;
  type: "handset_device";
};

export function signDeviceAuthToken(params: {
  handsetId: string;
  companyId: string;
  deviceId: string;
}): string {
  const ttlSeconds = getDeviceAuthTtlSeconds();
  const claims: DeviceAuthClaims = {
    sub: params.handsetId,
    company_id: params.companyId,
    device_id: params.deviceId,
    type: "handset_device",
  };

  return jwt.sign(claims, getDeviceAuthSecret(), {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
  });
}

export async function verifyDeviceAuthToken(authHeader: string | null): Promise<
  | {
      ok: true;
      handsetId: string;
      companyId: string;
      deviceId: string;
      handset: any;
    }
  | { ok: false; reason: string }
> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, reason: "Missing bearer token" };
  }

  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) {
    return { ok: false, reason: "Missing bearer token" };
  }

  let payload: JwtPayload | string;
  try {
    payload = jwt.verify(rawToken, getDeviceAuthSecret());
  } catch {
    return { ok: false, reason: "Invalid device auth token" };
  }

  if (!payload || typeof payload === "string") {
    return { ok: false, reason: "Invalid device auth token" };
  }

  const handsetId = String(payload.sub || "");
  const companyId = String((payload as any).company_id || "");
  const deviceId = String((payload as any).device_id || "");
  const type = String((payload as any).type || "");

  if (!handsetId || !companyId || !deviceId || type !== "handset_device") {
    return { ok: false, reason: "Invalid device auth token" };
  }

  const supabase = getSupabaseAdmin();
  const { data: handset, error } = await supabase
    .from("handsets")
    .select("id, company_id, device_id, status, high_scan_enabled, disabled_at")
    .eq("id", handsetId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !handset) {
    return { ok: false, reason: "Handset not found" };
  }

  if (String(handset.device_id || "") !== deviceId) {
    return { ok: false, reason: "Device mismatch" };
  }

  if (String(handset.status || "").toUpperCase() !== "ACTIVE" || handset.disabled_at) {
    return { ok: false, reason: "Handset disabled" };
  }

  return {
    ok: true,
    handsetId,
    companyId,
    deviceId,
    handset,
  };
}
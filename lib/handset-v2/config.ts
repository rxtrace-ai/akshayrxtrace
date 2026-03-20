import crypto from "crypto";

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function isHandsetV2Enabled(): boolean {
  return String(process.env.HANDSET_V2_ENABLED || "false").toLowerCase() === "true";
}

export function isHandsetV2UiEnabled(): boolean {
  const publicFlag = process.env.NEXT_PUBLIC_HANDSET_V2_ENABLED;
  if (publicFlag) return String(publicFlag).toLowerCase() === "true";
  return isHandsetV2Enabled();
}

export function getMaxTokenExpiryHours(): number {
  return parsePositiveInt(process.env.HANDSET_TOKEN_MAX_EXPIRY_HOURS, 24);
}

export function getDefaultMaxActivations(): number {
  return parsePositiveInt(process.env.HANDSET_TOKEN_MAX_ACTIVATIONS, 10);
}

export function getDeviceAuthTtlSeconds(): number {
  return parsePositiveInt(process.env.HANDSET_DEVICE_AUTH_TTL_SECONDS, 60 * 60 * 24 * 7);
}

export function getDeviceAuthSecret(): string {
  const secret = process.env.HANDSET_DEVICE_AUTH_SECRET || process.env.JWT_SECRET || "";
  if (!secret.trim()) {
    throw new Error("Missing HANDSET_DEVICE_AUTH_SECRET");
  }
  return secret;
}

function randomTokenChars(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

export function generateActivationToken(): string {
  return `RX-${randomTokenChars(6)}-${randomTokenChars(6)}`;
}

export function normalizeActivationToken(token: string): string {
  return String(token || "").trim().toUpperCase();
}

export function hashActivationToken(token: string): string {
  return crypto.createHash("sha256").update(normalizeActivationToken(token)).digest("hex");
}

export function redactToken(input: string): string {
  return input.replace(/RX-[A-Z0-9]{6}-[A-Z0-9]{6}/gi, "RX-******-******");
}

export function deriveTokenStatus(params: {
  revoked_at?: string | null;
  expires_at?: string | null;
  activation_count?: number | null;
  max_activations?: number | null;
  now?: Date;
}): "issued" | "active" | "exhausted" | "expired" | "revoked" {
  if (params.revoked_at) return "revoked";
  const now = params.now ?? new Date();
  const expiresAt = params.expires_at ? new Date(params.expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }

  const activationCount = Number(params.activation_count || 0);
  const maxActivations = Number(params.max_activations || 0);

  if (maxActivations > 0 && activationCount >= maxActivations) {
    return "exhausted";
  }
  if (activationCount > 0) {
    return "active";
  }
  return "issued";
}

export function safeIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}
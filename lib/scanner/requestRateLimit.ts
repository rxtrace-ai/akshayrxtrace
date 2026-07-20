import crypto from "crypto";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}

export function getScannerDeviceFingerprint(deviceContext: Record<string, unknown> | undefined) {
  if (!deviceContext) return null;

  const prioritizedKeys = [
    "device_id",
    "deviceId",
    "handset_id",
    "handsetId",
    "scanner_id",
    "scannerId",
    "printer_id",
    "printerId",
  ];

  for (const key of prioritizedKeys) {
    const value = String(deviceContext[key] ?? "").trim();
    if (value) return value;
  }

  return null;
}

async function consumeAll(descriptors: Array<{ key: string; refillPerMinute: number; burst: number }>) {
  for (const descriptor of descriptors) {
    const result = await consumeRateLimit(descriptor);
    if (!result.allowed) {
      return { allowed: false, retryAfterSeconds: result.retryAfterSeconds } as const;
    }
  }

  return { allowed: true } as const;
}

export async function enforceVerifyRateLimit(params: {
  req: Request;
  rawInput: string;
  companyId?: string | null;
}): Promise<RateLimitDecision> {
  const clientIp = getClientIp(params.req) || "unknown";
  const payloadHash = hashValue(params.rawInput || "empty");
  const scopePrefix = params.companyId ? `verify:company:${params.companyId}` : "verify:public";

  return consumeAll([
    { key: `${scopePrefix}:ip:${clientIp}`, refillPerMinute: 90, burst: 120 },
    { key: `${scopePrefix}:payload:${payloadHash}`, refillPerMinute: 30, burst: 45 },
  ]);
}

export async function enforceScanRateLimit(params: {
  req: Request;
  companyId: string;
  rawInput: string;
  deviceContext?: Record<string, unknown>;
}): Promise<RateLimitDecision> {
  const clientIp = getClientIp(params.req) || "unknown";
  const payloadHash = hashValue(params.rawInput || "empty");
  const deviceFingerprint = getScannerDeviceFingerprint(params.deviceContext);

  return consumeAll([
    { key: `scan:company:${params.companyId}:ip:${clientIp}`, refillPerMinute: 180, burst: 240 },
    {
      key: deviceFingerprint
        ? `scan:company:${params.companyId}:device:${hashValue(deviceFingerprint)}`
        : `scan:company:${params.companyId}:payload:${payloadHash}`,
      refillPerMinute: 120,
      burst: 180,
    },
  ]);
}

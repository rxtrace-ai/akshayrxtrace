import { randomUUID } from "crypto";
import { getCorrelationIdFromRequest } from "@/lib/observability/correlation";

export function getRequestIdFromRequest(req: Request, prefix: string): string {
  const headerKey =
    req.headers.get("Idempotency-Key") ||
    req.headers.get("idempotency-key") ||
    req.headers.get("x-idempotency-key") ||
    null;

  const normalized = headerKey ? String(headerKey).trim() : "";
  if (normalized) return `${prefix}:${normalized}`;

  const correlation = getCorrelationIdFromRequest(req.headers);
  if (correlation) return `${prefix}:corr:${correlation}`;

  return `${prefix}:gen:${randomUUID()}`;
}


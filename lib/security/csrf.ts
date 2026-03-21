import type { NextRequest } from "next/server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function shouldEnforceCsrfForApi(request: NextRequest, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return false;

  // Bearer-auth and machine-auth requests do not rely on browser cookies.
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) return false;

  return true;
}

export function isTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const normalizedOrigin = normalizeOrigin(origin);
  const trusted = new Set<string>();
  trusted.add(normalizeOrigin(request.nextUrl.origin));

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) trusted.add(normalizeOrigin(appUrl));

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) trusted.add(normalizeOrigin(publicAppUrl));

  return trusted.has(normalizedOrigin);
}

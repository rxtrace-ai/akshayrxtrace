import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getOrGenerateCorrelationId, logWithContext } from "@/lib/observability";
import { syncRazorpayPlansToTemplates } from "@/lib/billing/razorpaySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCorrelation(payload: Record<string, unknown>, status: number, correlationId: string) {
  const response = NextResponse.json(payload, { status });
  response.headers.set("X-Correlation-Id", correlationId);
  return response;
}

function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.INTERNAL_SYNC_TOKEN?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === secret;
}

export async function POST() {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "sync");
  const authHeader = headersList.get("authorization");

  if (!isAuthorized(authHeader)) {
    return withCorrelation({ error: "Unauthorized" }, 401, correlationId);
  }

  try {
    const result = await syncRazorpayPlansToTemplates();
    const ok = result.errors.length === 0;

    logWithContext(ok ? "info" : "warn", "Razorpay plans sync completed", {
      correlationId,
      route: "/api/internal/sync/razorpay-plans",
      method: "POST",
      fetched: result.fetched,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
    });

    return withCorrelation(
      {
        success: ok,
        fetched: result.fetched,
        synced: result.synced,
        skipped: result.skipped,
        errors: result.errors,
      },
      ok ? 200 : 207,
      correlationId
    );
  } catch (error: any) {
    logWithContext("error", "Razorpay plans sync failed", {
      correlationId,
      route: "/api/internal/sync/razorpay-plans",
      method: "POST",
      error: error?.message ?? String(error),
    });
    return withCorrelation(
      { error: error?.message ?? "Razorpay plans sync failed" },
      500,
      correlationId
    );
  }
}

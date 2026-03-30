import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { apiJson } from "@/lib/api/response";
import { consumeRateLimit } from "@/lib/security/rateLimit";
import { getOrGenerateCorrelationId } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const correlationId = getOrGenerateCorrelationId(headersList, "public");

  try {
    const clientIp = getClientIp(req) || "unknown";
    const limit = await consumeRateLimit({
      key: `public-demo-request:${clientIp}`,
      refillPerMinute: 5,
      burst: 10,
    });

    if (!limit.allowed) {
      const response = apiJson(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many demo requests. Please try again shortly.",
          },
          correlation_id: correlationId,
        },
        { status: 429 }
      );
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      response.headers.set("X-Correlation-Id", correlationId);
      return response;
    }

    const body = await req.json().catch(() => ({}));
    const name = normalizeText((body as Record<string, unknown>).name, 120);
    const companyName = normalizeText((body as Record<string, unknown>).company_name, 160);
    const email = normalizeText((body as Record<string, unknown>).email, 160).toLowerCase();
    const phone = normalizeText((body as Record<string, unknown>).phone, 40);
    const message = normalizeText((body as Record<string, unknown>).message, 2000);
    const source = normalizeText((body as Record<string, unknown>).source, 80) || "landing";

    if (!name || !companyName || !email || !phone) {
      const response = apiJson(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Name, company name, email, and phone are required.",
          },
          correlation_id: correlationId,
        },
        { status: 400 }
      );
      response.headers.set("X-Correlation-Id", correlationId);
      return response;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("demo_requests")
      .insert({
        name,
        company_name: companyName,
        email,
        phone,
        message: message || null,
        source,
        ip: clientIp,
        user_agent: req.headers.get("user-agent"),
      })
      .select("id, created_at")
      .single();

    if (error) {
      const response = apiJson(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error.message,
          },
          correlation_id: correlationId,
        },
        { status: 500 }
      );
      response.headers.set("X-Correlation-Id", correlationId);
      return response;
    }

    const response = apiJson(
      {
        success: true,
        request: data,
        correlation_id: correlationId,
      },
      { status: 201 }
    );
    response.headers.set("X-Correlation-Id", correlationId);
    return response;
  } catch (err) {
    const response = apiJson(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Failed to submit demo request.",
        },
        correlation_id: correlationId,
      },
      { status: 500 }
    );
    response.headers.set("X-Correlation-Id", correlationId);
    return response;
  }
}

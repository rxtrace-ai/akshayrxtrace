import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from "@/lib/supabase/server";
import { hashSeatInviteToken } from "@/lib/seats/invitations";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export async function POST(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const rateLimit = await consumeRateLimit({
    key: `seat-invite-accept:${ip}`,
    refillPerMinute: 10,
    burst: 10,
  });
  if (!rateLimit.allowed) {
    return apiJson(
      { error: "RATE_LIMITED", retry_after_seconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();

  if (!token) {
    return apiJson({ error: "INVITATION_TOKEN_REQUIRED" }, { status: 400 });
  }
  if (!user.email) {
    return apiJson({ error: "EMAIL_REQUIRED" }, { status: 400 });
  }
  const normalizedEmail = String(user.email).toLowerCase().trim();
  const fullName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    normalizedEmail ||
    "";

  // Ensure profile exists so dashboards can resolve member details immediately.
  try {
    await supabase
      .from("user_profiles")
      .upsert(
        {
          id: user.id,
          user_id: user.id,
          email: normalizedEmail,
          full_name: fullName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
  } catch {
    // best-effort profile upsert
  }

  const tokenHash = hashSeatInviteToken(token);
  const { data, error } = await supabase.rpc("accept_seat_invitation", {
    p_token_hash: tokenHash,
    p_user_id: user.id,
    p_email: user.email,
  });

  if (error) {
    const message = String(error.message || "Invitation acceptance failed");
    if (message.includes("INVITATION_NOT_FOUND")) {
      return apiJson({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
    }
    if (message.includes("INVITATION_ALREADY_USED")) {
      return apiJson({ error: "INVITATION_ALREADY_USED" }, { status: 409 });
    }
    if (message.includes("INVITATION_EXPIRED")) {
      return apiJson({ error: "INVITATION_EXPIRED" }, { status: 410 });
    }
    if (message.includes("INVITATION_REVOKED")) {
      return apiJson({ error: "INVITATION_REVOKED" }, { status: 409 });
    }
    if (message.includes("INVITATION_EMAIL_MISMATCH")) {
      return apiJson({ error: "INVITATION_EMAIL_MISMATCH" }, { status: 403 });
    }
    if (message.includes("USER_ALREADY_MEMBER")) {
      return apiJson({ error: "USER_ALREADY_MEMBER" }, { status: 409 });
    }
    if (message.includes("SEAT_LIMIT_EXCEEDED")) {
      return apiJson({ error: "SEAT_LIMIT_EXCEEDED" }, { status: 409 });
    }
    return apiJson({ error: message }, { status: 500 });
  }

  const payload = Array.isArray(data) ? data[0] : data;
  return apiJson({
    ...(payload ?? { success: true }),
    seat_status: "active",
  });
}



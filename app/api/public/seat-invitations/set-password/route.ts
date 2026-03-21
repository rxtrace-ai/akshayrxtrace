import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { hashSeatInviteToken } from "@/lib/seats/invitations";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export async function POST(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const rateLimit = await consumeRateLimit({
    key: `seat-invite-set-password:${ip}`,
    refillPerMinute: 10,
    burst: 10,
  });
  if (!rateLimit.allowed) {
    return apiJson(
      { error: "RATE_LIMITED", retry_after_seconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const password = String(body.password || "");

  if (!token) {
    return apiJson({ error: "INVITATION_TOKEN_REQUIRED" }, { status: 400 });
  }
  if (password.length < 8) {
    return apiJson({ error: "PASSWORD_TOO_SHORT" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const tokenHash = hashSeatInviteToken(token);

  const { data: invite, error: inviteError } = await admin
    .from("seat_invitations")
    .select("id, email, sent_to_email, status, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    return apiJson({ error: inviteError.message }, { status: 500 });
  }
  if (!invite) {
    return apiJson({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
  }
  if (invite.status === "revoked") {
    return apiJson({ error: "INVITATION_REVOKED" }, { status: 409 });
  }
  if (invite.status !== "pending" || invite.consumed_at) {
    return apiJson({ error: "INVITATION_ALREADY_USED" }, { status: 409 });
  }
  if (invite.expires_at && Date.now() > new Date(invite.expires_at).getTime()) {
    return apiJson({ error: "INVITATION_EXPIRED" }, { status: 410 });
  }

  const invitationEmail = String(invite.email || invite.sent_to_email || "").toLowerCase().trim();
  if (!invitationEmail) {
    return apiJson({ error: "INVITATION_EMAIL_MISSING" }, { status: 500 });
  }

  const { data: existingUsers, error: existingUserError } = await admin
    .schema("auth")
    .from("users")
    .select("id")
    .eq("email", invitationEmail)
    .limit(1);

  if (existingUserError) {
    return apiJson({ error: existingUserError.message }, { status: 500 });
  }
  if ((existingUsers || []).length > 0) {
    return apiJson({ error: "ACCOUNT_EXISTS" }, { status: 409 });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invitationEmail,
    password,
    email_confirm: true,
  });

  if (createError || !created.user?.id) {
    return apiJson(
      { error: createError?.message || "ACCOUNT_CREATION_FAILED" },
      { status: 500 }
    );
  }

  // Best-effort profile row for downstream dashboard/profile lookups.
  try {
    await admin.from("user_profiles").upsert(
      {
        id: created.user.id,
        user_id: created.user.id,
        email: invitationEmail,
      },
      { onConflict: "id" }
    );
  } catch {
    // best effort
  }

  return apiJson({
    success: true,
    invitation_email: invitationEmail,
  });
}



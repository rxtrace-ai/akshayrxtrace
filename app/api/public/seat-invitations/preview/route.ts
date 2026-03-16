import { NextResponse } from "next/server";
import { hashSeatInviteToken } from "@/lib/seats/invitations";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rateLimit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") || "").trim();

  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const rateLimit = consumeRateLimit({
    key: `seat-invite-preview:${ip}`,
    refillPerMinute: 30,
    burst: 30,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retry_after_seconds: rateLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  if (!token) {
    return NextResponse.json({ error: "INVITATION_TOKEN_REQUIRED" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const tokenHash = hashSeatInviteToken(token);

  const { data: invite, error } = await admin
    .from("seat_invitations")
    .select("id, email, sent_to_email, status, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
  }

  if (invite.status === "revoked") {
    return NextResponse.json({ error: "INVITATION_REVOKED" }, { status: 409 });
  }
  if (invite.status !== "pending" || invite.consumed_at) {
    return NextResponse.json({ error: "INVITATION_ALREADY_USED" }, { status: 409 });
  }
  if (invite.expires_at && Date.now() > new Date(invite.expires_at).getTime()) {
    return NextResponse.json({ error: "INVITATION_EXPIRED" }, { status: 410 });
  }

  const invitationEmail = String(invite.email || invite.sent_to_email || "").toLowerCase().trim();
  if (!invitationEmail) {
    return NextResponse.json({ error: "INVITATION_EMAIL_MISSING" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    invitation_email: invitationEmail,
  });
}


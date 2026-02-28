import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { createSeatInviteToken, hashSeatInviteToken } from "@/lib/seats/invitations";
import { sendInvitationEmail } from "@/lib/email";

function normalizeRole(raw: unknown): "admin" | "operator" | "viewer" {
  const value = String(raw || "operator").trim().toLowerCase();
  if (value === "admin" || value === "viewer") return value;
  return "operator";
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = await resolveCompanyForUser(supabase, user.id, "id, company_name");
  if (!resolved || !resolved.isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || body.name || "").trim();
  const role = normalizeRole(body.role);
  const plantIds = Array.isArray(body.plant_ids)
    ? body.plant_ids.map((value: unknown) => String(value)).filter(Boolean)
    : [];

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  if (plantIds.length === 0) {
    return NextResponse.json({ error: "PLANT_SELECTION_REQUIRED" }, { status: 400 });
  }

  const rawToken = createSeatInviteToken();
  const tokenHash = hashSeatInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc("create_seat_invitation_atomic", {
    p_company_id: resolved.companyId,
    p_actor_user_id: user.id,
    p_email: email,
    p_full_name: fullName || null,
    p_role: role,
    p_plant_ids: plantIds,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error) {
    const message = String(error.message || "Seat invite failed");
    if (message.includes("TRIAL_EXPIRED")) {
      return NextResponse.json({ error: "TRIAL_EXPIRED" }, { status: 403 });
    }
    if (message.includes("SEAT_QUOTA_EXCEEDED")) {
      return NextResponse.json({ error: "SEAT_QUOTA_EXCEEDED" }, { status: 403 });
    }
    if (message.includes("PLANT_SELECTION_REQUIRED")) {
      return NextResponse.json({ error: "PLANT_SELECTION_REQUIRED" }, { status: 400 });
    }
    if (message.includes("INVALID_PLANT_SELECTION")) {
      return NextResponse.json({ error: "INVALID_PLANT_SELECTION" }, { status: 400 });
    }
    if (message.includes("SEAT_ALREADY_EXISTS")) {
      return NextResponse.json({ error: "SEAT_ALREADY_EXISTS" }, { status: 409 });
    }
    if (message.includes("COMPANY_FROZEN")) {
      return NextResponse.json({ error: "COMPANY_FROZEN" }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const rpcPayload = Array.isArray(data) ? data[0] : data;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const inviteUrl = `${baseUrl}/invite/accept?token=${encodeURIComponent(rawToken)}`;

  let emailSent = false;
  let emailError: string | null = null;
  try {
    const mailResult = await sendInvitationEmail({
      to: email,
      companyName: String((resolved.company as any)?.company_name || "Your Company"),
      role,
      inviterName: String(user.email || user.id),
      inviteUrl,
    });
    emailSent = Boolean((mailResult as any)?.success);
    if (!emailSent) {
      emailError = String((mailResult as any)?.error || "EMAIL_SEND_FAILED");
    }
  } catch (err: any) {
    emailSent = false;
    emailError = err?.message || "EMAIL_SEND_FAILED";
  }

  return NextResponse.json({
    success: true,
    seat: rpcPayload?.seat || null,
    invitation_id: rpcPayload?.invitation_id || null,
    invite_url: inviteUrl,
    email_sent: emailSent,
    email_error: emailError,
  });
}

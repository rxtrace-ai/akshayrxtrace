import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { sendInviteEmail } from "@/lib/email";

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
  if (!resolved) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let canInvite = resolved.isOwner;
  if (!canInvite) {
    const { data: inviterSeat, error: inviterSeatError } = await supabase
      .from("seats")
      .select("id")
      .eq("company_id", resolved.companyId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("role", "admin")
      .maybeSingle();

    if (inviterSeatError) {
      return NextResponse.json({ error: inviterSeatError.message }, { status: 500 });
    }

    canInvite = Boolean(inviterSeat?.id);
  }

  if (!canInvite) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
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

  const { data, error } = await supabase.rpc("create_seat_invitation_atomic", {
    p_company_id: resolved.companyId,
    p_email: email,
    p_role: role,
    p_plant_ids: plantIds,
    p_invited_by: user.id,
  });

  if (error) {
    const message = String(error.message || "Seat invite failed");
    if (message.includes("TRIAL_EXPIRED")) {
      return NextResponse.json({ error: "TRIAL_EXPIRED" }, { status: 403 });
    }
    if (message.includes("SEAT_QUOTA_EXCEEDED") || message.includes("SEAT_LIMIT_EXCEEDED")) {
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
    if (message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const rpcPayload = Array.isArray(data) ? data[0] : data;
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const normalizedAppUrl = appUrl.replace(/\/+$/, "");
  const rpcInviteUrl = typeof rpcPayload?.invite_url === "string" ? rpcPayload.invite_url : null;
  const rpcToken = typeof rpcPayload?.token === "string" ? rpcPayload.token : null;

  const inviteUrl =
    rpcInviteUrl
      ? (rpcInviteUrl.startsWith("http://") || rpcInviteUrl.startsWith("https://")
          ? rpcInviteUrl
          : `${normalizedAppUrl}${rpcInviteUrl.startsWith("/") ? "" : "/"}${rpcInviteUrl}`)
      : (rpcToken ? `${normalizedAppUrl}/invite/accept?token=${encodeURIComponent(rpcToken)}` : null);

  let emailSent = false;
  let emailError: string | null = null;
  if (!inviteUrl) {
    emailError = "INVITE_LINK_UNAVAILABLE";
    console.error("Invite email failed", {
      reason: "INVITE_LINK_UNAVAILABLE",
      inviteEmail: email,
      companyId: resolved.companyId,
    });
  } else {
    try {
      const mailResult = await sendInviteEmail({
        to: email,
        companyName: String((resolved.company as any)?.company_name || "Your Company"),
        inviteUrl,
      });
      emailSent = Boolean(mailResult?.success);
      if (!emailSent && mailResult && "error" in mailResult) {
        emailError = `EMAIL_SEND_FAILED: ${String(mailResult.error || "Unknown provider error")}`;
      }
    } catch (err: any) {
      emailSent = false;
      emailError = err?.message || "EMAIL_SEND_FAILED";
    }
  }

  return NextResponse.json({
    success: true,
    inviteCreated: true,
    emailSent,
    invite: {
      email,
      role,
      plant_ids: plantIds,
      status: "pending",
      expires_at: rpcPayload?.expires_at ?? null,
    },
    seat: rpcPayload?.seat || null,
    invitation_id: rpcPayload?.invitation_id || null,
    invite_url: inviteUrl,
    email_sent: emailSent,
    email_error: emailError,
  });
}

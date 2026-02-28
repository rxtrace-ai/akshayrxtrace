import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { hashSeatInviteToken } from "@/lib/seats/invitations";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();

  if (!token) {
    return NextResponse.json({ error: "INVITATION_TOKEN_REQUIRED" }, { status: 400 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "EMAIL_REQUIRED" }, { status: 400 });
  }

  const tokenHash = hashSeatInviteToken(token);
  const { data, error } = await supabase.rpc("accept_seat_invitation_atomic", {
    p_token_hash: tokenHash,
    p_user_id: user.id,
    p_email: user.email,
  });

  if (error) {
    const message = String(error.message || "Invitation acceptance failed");
    if (message.includes("INVITATION_NOT_FOUND")) {
      return NextResponse.json({ error: "INVITATION_NOT_FOUND" }, { status: 404 });
    }
    if (message.includes("INVITATION_ALREADY_USED")) {
      return NextResponse.json({ error: "INVITATION_ALREADY_USED" }, { status: 409 });
    }
    if (message.includes("INVITATION_EXPIRED")) {
      return NextResponse.json({ error: "INVITATION_EXPIRED" }, { status: 410 });
    }
    if (message.includes("INVITATION_REVOKED")) {
      return NextResponse.json({ error: "INVITATION_REVOKED" }, { status: 409 });
    }
    if (message.includes("INVITATION_EMAIL_MISMATCH")) {
      return NextResponse.json({ error: "INVITATION_EMAIL_MISMATCH" }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const payload = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(payload ?? { success: true });
}

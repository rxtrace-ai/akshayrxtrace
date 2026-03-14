import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();

    if (!token || !UUID_REGEX.test(token)) {
      return NextResponse.json({ valid: false, reason: "invalid invite" });
    }

    const supabase = getSupabaseAdmin();
    const { data: invite, error: inviteError } = await supabase
      .from("company_invites")
      .select("id, company_id, email, role, plant_id, status")
      .eq("token", token)
      .maybeSingle();

    if (inviteError) {
      throw inviteError;
    }

    if (!invite) {
      return NextResponse.json({ valid: false, reason: "invalid invite" });
    }

    const inviteStatus = normalizeStatus((invite as any).status);
    if (inviteStatus !== "pending") {
      if (inviteStatus === "accepted") {
        return NextResponse.json({ valid: false, reason: "already accepted" });
      }
      if (inviteStatus === "revoked") {
        return NextResponse.json({ valid: false, reason: "revoked" });
      }
      return NextResponse.json({ valid: false, reason: "invalid invite" });
    }

    const companyId = String((invite as any).company_id || "");
    const { data: subscription, error: subError } = await supabase
      .from("company_subscriptions")
      .select("status, updated_at")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) {
      throw subError;
    }

    const subscriptionStatus = normalizeStatus((subscription as any)?.status);
    if (subscriptionStatus !== "active") {
      return NextResponse.json({ valid: false, reason: "subscription inactive" });
    }

    return NextResponse.json({
      valid: true,
      email: (invite as any).email,
      companyId,
      role: (invite as any).role,
      plantId: (invite as any).plant_id ?? null,
    });
  } catch (error) {
    console.error("Invite acceptance failed:", error);
    return NextResponse.json({ valid: false, reason: "invalid invite" }, { status: 500 });
  }
}

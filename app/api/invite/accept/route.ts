import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
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
      return NextResponse.json({ success: false, error: "Invalid invite token" }, { status: 400 });
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
      return NextResponse.json({ success: false, error: "Invalid invite" }, { status: 404 });
    }

    const inviteStatus = normalizeStatus((invite as any).status);
    if (inviteStatus !== "pending") {
      if (inviteStatus === "accepted") {
        return NextResponse.json({ success: false, error: "Invite already accepted" }, { status: 409 });
      }
      if (inviteStatus === "revoked") {
        return NextResponse.json({ success: false, error: "Invite revoked" }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: "Invalid invite" }, { status: 400 });
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
      return NextResponse.json({ success: false, error: "Subscription inactive" }, { status: 403 });
    }

    const authClient = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!user.email) {
      return NextResponse.json({ success: false, error: "Invite email mismatch" }, { status: 403 });
    }

    const inviteEmail = String((invite as any).email || "").trim().toLowerCase();
    if (inviteEmail && inviteEmail !== user.email.toLowerCase()) {
      return NextResponse.json({ success: false, error: "Invite email mismatch" }, { status: 403 });
    }

    const { data: existingMember, error: existingError } = await supabase
      .from("company_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    const nowIso = new Date().toISOString();

    if (!existingMember) {
      const { error: insertError } = await supabase.from("company_members").insert({
        user_id: user.id,
        company_id: companyId,
        role: (invite as any).role,
        plant_id: (invite as any).plant_id ?? null,
        status: "active",
        joined_at: nowIso,
      });

      if (insertError) {
        const message = String(insertError.message || "");
        if (!message.toLowerCase().includes("duplicate")) {
          throw insertError;
        }
      }
    }

    const { error: updateError } = await supabase
      .from("company_invites")
      .update({ status: "accepted", accepted_at: nowIso })
      .eq("token", token)
      .eq("status", "pending");

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      companyId,
      role: (invite as any).role,
    });
  } catch (error) {
    console.error("Invite acceptance failed:", error);
    return NextResponse.json({ success: false, error: "Invite acceptance failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/config";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractResetLink(data: any): string {
  const direct = String(data?.action_link || "").trim();
  if (direct) return direct;

  const nested = String(data?.properties?.action_link || "").trim();
  if (nested) return nested;

  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "INVALID_EMAIL" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const redirectTo = `${getAppUrl()}/auth/reset-password`;
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message || "PASSWORD_RESET_LINK_FAILED" }, { status: 500 });
    }

    const resetLink = extractResetLink(data);
    if (!resetLink) {
      return NextResponse.json({ success: false, error: "PASSWORD_RESET_LINK_MISSING" }, { status: 500 });
    }

    await sendTransactionalEmail({
      to: email,
      event: "PASSWORD_RESET",
      payload: {
        user_name: "there",
        reset_link: resetLink,
      },
    });

    return NextResponse.json({ success: true, message: "PASSWORD_RESET_EMAIL_SENT" });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: String(error?.message || "PASSWORD_RESET_EMAIL_FAILED") },
      { status: 500 }
    );
  }
}


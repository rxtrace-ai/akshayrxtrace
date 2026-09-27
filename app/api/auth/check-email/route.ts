import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fail, ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function emailExists(email: string) {
  const supabase = getSupabaseAdmin();
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw error;
    }

    if (data.users.some((user) => user.email?.toLowerCase() === normalizedEmail)) {
      return true;
    }

    if (data.users.length < 1000) {
      return false;
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!emailPattern.test(normalizedEmail)) {
      return fail("INVALID_EMAIL", "Enter a valid company email.", 400);
    }

    return ok({ exists: await emailExists(normalizedEmail) });
  } catch (error) {
    console.error("Check email error:", error);
    return fail("CHECK_EMAIL_FAILED", "Unable to check email. Please try again.", 500);
  }
}

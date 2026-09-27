import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fail, ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

async function hasRegisteredEmail(email: string) {
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
    const { email, password, fullName } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedFullName = String(fullName || "").trim();

    if (normalizedFullName.length < 3) {
      return fail("INVALID_FULL_NAME", "Please enter your full name.", 400);
    }

    if (!emailPattern.test(normalizedEmail)) {
      return fail("INVALID_EMAIL", "Enter a valid company email.", 400);
    }

    if (!passwordPattern.test(String(password || ""))) {
      return fail(
        "INVALID_PASSWORD",
        "Password must contain 8 characters, 1 uppercase and 1 number.",
        400
      );
    }

    const supabase = getSupabaseAdmin();

    if (await hasRegisteredEmail(normalizedEmail)) {
      return fail("EMAIL_ALREADY_REGISTERED", "Email already registered.", 409);
    }

    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_verifications")
      .select("id, expires_at, verified")
      .eq("email", normalizedEmail)
      .eq("verified", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) {
      console.error("Complete signup OTP lookup error:", otpError);
      return fail("OTP_LOOKUP_FAILED", "OTP is invalid.", 500);
    }

    if (!otpRecord) {
      return fail("OTP_INVALID", "OTP is invalid.", 401);
    }

    if (new Date() > new Date(otpRecord.expires_at)) {
      await supabase.from("otp_verifications").delete().eq("id", otpRecord.id);
      return fail("OTP_EXPIRED", "OTP expired.", 410);
    }

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedFullName,
      },
    });

    if (createError) {
      const message = createError.message.toLowerCase();
      if (message.includes("already") || message.includes("registered")) {
        return fail("EMAIL_ALREADY_REGISTERED", "Email already registered.", 409);
      }

      console.error("Complete signup create user error:", createError);
      return fail("SIGNUP_FAILED", "Unable to create account. Please try again.", 500);
    }

    await supabase.from("otp_verifications").delete().eq("id", otpRecord.id);

    return ok({
      userId: createdUser.user?.id,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Complete signup error:", error);
    return fail("SIGNUP_FAILED", "Unable to create account. Please try again.", 500);
  }
}

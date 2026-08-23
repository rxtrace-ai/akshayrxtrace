// app/auth/signup/page.tsx
"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { getAppUrl } from "@/lib/config";

export default function SignUp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const fullName = formData.get("full_name") as string;

    try {
      const { data: authResponse, error: signUpError } = await supabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${getAppUrl()}/auth/callback?next=/onboarding/company-setup`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("already registered") || signUpError.message.includes("User already registered")) {
          setError("This email is already registered. Please sign in instead.");
          setLoading(false);
          setTimeout(() => router.push("/login"), 2000);
          return;
        }
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (!authResponse.user) {
        setError("Signup failed. Please try again.");
        setLoading(false);
        return;
      }

      const otpResponse = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!otpResponse.ok) {
        const otpError = await otpResponse.json();
        setError(`Failed to send OTP: ${otpError.error || "Unknown error"}`);
        setLoading(false);
        return;
      }

      localStorage.setItem("pending_verification_email", email);
      localStorage.setItem("pending_user_name", fullName);
      localStorage.setItem("pending_verification_password", password);

      router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
    } catch (signupError) {
      console.error("Signup error:", signupError);
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-orange-50 p-4">
      <Card className="w-full max-w-md p-8 shadow-2xl">
        <CardHeader className="mb-6 text-center">
          <CardTitle className="text-3xl font-bold text-[#0052CC]">Create Account</CardTitle>
          <p className="mt-2 text-gray-600">Start your 3-day trial. Activation is confirmed through an INR 1 payment.</p>
        </CardHeader>

        <CardContent>
          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input name="full_name" placeholder="Full Name *" required />
            <Input name="email" type="email" placeholder="Email Address *" required />
            <Input
              name="password"
              type="password"
              placeholder="Password (min 8 characters, include letters and numbers) *"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="-mt-3 text-xs text-gray-500">Password must be at least 8 characters long</p>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
              <p className="mb-2 font-semibold text-[#0052CC]">Email Verification with OTP</p>
              <p>You&apos;ll receive a 6-digit code to verify your email address.</p>
            </div>

            <Button type="submit" className="w-full bg-orange-500 py-6 text-lg hover:bg-orange-600" disabled={loading}>
              {loading ? "Creating Account..." : "Create Account and Get OTP"}
            </Button>
          </form>

          <p className="mt-8 text-center text-gray-600">
            Already have an account?{" "}
            <a href="/login" className="font-semibold text-[#0052CC] hover:underline">
              Sign In
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

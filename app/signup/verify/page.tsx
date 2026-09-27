"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { OtpInput } from "@/components/auth/OtpInput";
import { supabaseClient } from "@/lib/supabase/client";

function getOtpMessage(code?: string, fallback?: string) {
  if (code === "OTP_EXPIRED") {
    return "OTP expired.";
  }

  if (code === "INVALID_OTP" || code === "OTP_INVALID" || code === "OTP_NOT_FOUND") {
    return "OTP is invalid.";
  }

  return fallback || "OTP is invalid.";
}

function SignupVerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const storedEmail = localStorage.getItem("rxtrace_signup_email") || "";
    const storedFullName = localStorage.getItem("rxtrace_signup_full_name") || "";
    const storedPassword = localStorage.getItem("rxtrace_signup_password") || "";
    const emailParam = searchParams.get("email") || "";
    const resolvedEmail = (emailParam || storedEmail).trim().toLowerCase();

    if (!resolvedEmail || !storedFullName || !storedPassword) {
      setError("Please restart signup to verify your email.");
      return;
    }

    setEmail(resolvedEmail);
    setFullName(storedFullName);
    setPassword(storedPassword);
    localStorage.setItem("rxtrace_signup_email", resolvedEmail);
  }, [searchParams]);

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const clearPendingSignup = () => {
    localStorage.removeItem("rxtrace_signup_email");
    localStorage.removeItem("rxtrace_signup_full_name");
    localStorage.removeItem("rxtrace_signup_password");
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const otpValue = otp.join("");

    if (otpValue.length !== 6) {
      setError("OTP is invalid.");
      return;
    }

    if (!email || !fullName || !password) {
      setError("Please restart signup to verify your email.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const verifyResponse = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otpValue }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));

      if (!verifyResponse.ok) {
        setError(getOtpMessage(verifyPayload?.error?.code, verifyPayload?.error?.message));
        setOtp(["", "", "", "", "", ""]);
        setLoading(false);
        return;
      }

      const completeResponse = await fetch("/api/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });
      const completePayload = await completeResponse.json().catch(() => ({}));

      if (!completeResponse.ok) {
        const message = completePayload?.error?.message || "Unable to create account. Please try again.";
        setError(message);
        toast.error(message);
        setLoading(false);
        return;
      }

      const { error: signInError } = await supabaseClient().auth.signInWithPassword({
        email,
        password,
      });

      clearPendingSignup();

      if (signInError) {
        router.replace("/login?verified=1");
        return;
      }

      await fetch("/api/auth/ensure-profile", { method: "POST" }).catch(() => undefined);
      router.replace("/signup/company");
    } catch {
      toast.error("Network error.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError("Please restart signup to verify your email.");
      return;
    }

    setResendLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        toast.error("Unable to resend OTP. Please try again.");
        setResendLoading(false);
        return;
      }

      setOtp(["", "", "", "", "", ""]);
      setCountdown(60);
      toast.success("New OTP sent.");
      setResendLoading(false);
    } catch {
      toast.error("Network error.");
      setResendLoading(false);
    }
  };

  const handleChangeEmail = () => {
    clearPendingSignup();
    router.push("/signup");
  };

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[45%_55%] md:grid-cols-[35%_65%]">
        <aside className="hidden bg-[#0F4C81] px-10 py-10 text-white md:flex md:flex-col md:justify-between lg:px-14">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0F4C81] shadow-lg">
                <ShieldCheck className="h-7 w-7" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-normal">RxTrace</p>
                <p className="text-xs font-bold tracking-[0.28em] text-blue-100">BE ORIGINAL</p>
              </div>
            </div>

            <div className="mt-24 max-w-xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-blue-100">
                Enterprise Healthcare SaaS
              </p>
              <h1 className="text-4xl font-bold leading-tight tracking-normal lg:text-5xl">
                Verify Your Email
              </h1>
              <p className="mt-6 text-base leading-8 text-blue-50 lg:text-lg">
                Enter the secure 6-digit code sent to your official email to continue onboarding.
              </p>
            </div>
          </div>

          <p className="text-sm font-medium text-blue-100">&copy; 2026 RxTrace</p>
        </aside>

        <section className="flex min-h-screen items-center justify-center px-6 py-8 sm:px-8 md:px-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-8 flex items-center gap-3 md:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0F4C81] text-white shadow-lg">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0F4C81]">RxTrace</p>
                <p className="text-xs font-bold tracking-[0.26em] text-[#1E88E5]">BE ORIGINAL</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_24px_70px_rgba(15,76,129,0.14)] sm:p-8">
              <div className="mb-8">
                <p className="mb-3 text-center text-sm font-bold text-[#0F4C81]">Step 2 of 3</p>
                <div className="grid grid-cols-3 gap-3">
                  {["Step 1", "Step 2", "Step 3"].map((step, index) => (
                    <div key={step} className="space-y-2">
                      <div className={index <= 1 ? "h-2 rounded-full bg-[#0F4C81]" : "h-2 rounded-full bg-slate-200"} />
                      <p className={index <= 1 ? "text-center text-xs font-semibold text-[#0F4C81]" : "text-center text-xs font-semibold text-slate-400"}>
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-8 text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF4FF] text-[#0F4C81]">
                  <Mail className="h-7 w-7" aria-hidden="true" />
                </div>
                <h2 className="text-3xl font-bold tracking-normal text-slate-950">Enter OTP</h2>
                <p className="mt-2 break-all text-sm text-slate-500">
                  We sent a 6-digit code to <span className="font-semibold text-slate-700">{email || "your email"}</span>
                </p>
              </div>

              {error ? (
                <div className="mb-5 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}

              <form onSubmit={handleVerify} className="space-y-6">
                <OtpInput value={otp} onChange={setOtp} disabled={loading} error={Boolean(error)} />

                <button
                  type="submit"
                  disabled={loading || otp.join("").length !== 6}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Verify &amp; Continue
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 space-y-3 text-center">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading || countdown > 0}
                  className="h-11 w-full rounded-[10px] border border-[#0F4C81] bg-white px-5 text-sm font-bold text-[#0F4C81] transition hover:bg-[#EAF4FF] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resendLoading ? "Sending..." : countdown > 0 ? `Resend OTP after ${countdown}s` : "Resend OTP"}
                </button>

                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="text-sm font-semibold text-slate-600 transition hover:text-[#0F4C81] hover:underline"
                >
                  Change Email
                </button>
              </div>

              <Link
                href="/login"
                className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-sm font-semibold text-[#0F4C81] transition hover:text-[#0A3B63] hover:underline"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Sign In
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function SignupVerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <SignupVerifyContent />
    </Suspense>
  );
}

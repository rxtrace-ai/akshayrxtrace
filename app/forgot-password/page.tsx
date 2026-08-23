"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Company email is required.");
      return;
    }

    if (!emailPattern.test(email.trim())) {
      setError("Enter a valid company email.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        toast.error("Network error.");
        setLoading(false);
        return;
      }

      setEmailSent(true);
      setLoading(false);
    } catch {
      toast.error("Network error.");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-10 text-slate-950">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0F4C81] text-white shadow-lg">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0F4C81]">RxTrace</p>
            <p className="text-xs font-bold tracking-[0.26em] text-[#1E88E5]">BE ORIGINAL</p>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_24px_70px_rgba(15,76,129,0.14)] sm:p-8">
          {emailSent ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-bold text-slate-950">Reset Link Sent</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Check your email for a secure password reset link.
              </p>
              <Link
                href="/login"
                className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold tracking-normal text-slate-950">Forgot Password?</h1>
                <p className="mt-2 text-sm text-slate-500">Enter your company email to receive a reset link.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <label htmlFor="reset-email" className="text-sm font-semibold text-slate-800">
                    Company Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      placeholder="name@company.com"
                      autoComplete="email"
                      required
                      disabled={loading}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "reset-email-error" : undefined}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                  </div>
                  {error ? (
                    <p id="reset-email-error" className="text-sm font-medium text-red-600">
                      {error}
                    </p>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </button>
              </form>

              <Link
                href="/login"
                className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-[#0F4C81] transition hover:text-[#0A3B63] hover:underline"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to Sign In
              </Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

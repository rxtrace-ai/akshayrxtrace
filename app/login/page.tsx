"use client";

import { FormEvent, ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { supabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AuthInputProps = {
  id: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  disabled?: boolean;
  error?: string;
  icon: ReactNode;
  action?: ReactNode;
  onChange: (value: string) => void;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthInput({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  disabled,
  error,
  icon,
  action,
  onChange,
}: AuthInputProps) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-12 w-full rounded-[10px] border bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition",
            "placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15",
            "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
            error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-200"
          )}
        />
        {action}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function getErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }

  if (normalized.includes("user not found") || normalized.includes("account")) {
    return "Account not found.";
  }

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many login attempts.";
  }

  if (normalized.includes("fetch") || normalized.includes("network")) {
    return "Network error.";
  }

  return "Invalid email or password.";
}

function getSafePath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({
    email: "",
    password: "",
  });

  const redirectAfterLogin = useMemo(() => {
    const inviteToken = searchParams.get("invite_token");
    if (inviteToken) {
      return `/invite/accept?token=${encodeURIComponent(inviteToken)}`;
    }

    return getSafePath(searchParams.get("redirect")) ?? getSafePath(searchParams.get("next"));
  }, [searchParams]);

  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      toast.error(decodeURIComponent(urlError));
    }
  }, [searchParams]);

  const validateForm = () => {
    const nextErrors = {
      email: "",
      password: "",
    };

    if (!email.trim()) {
      nextErrors.email = "Company email is required.";
    } else if (!emailPattern.test(email.trim())) {
      nextErrors.email = "Enter a valid company email.";
    }

    if (!password) {
      nextErrors.password = "Password is required.";
    }

    setFieldErrors(nextErrors);
    return !nextErrors.email && !nextErrors.password;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const supabase = supabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        toast.error(getErrorMessage(error.message));
        setLoading(false);
        return;
      }

      if (!data.user) {
        toast.error("Invalid email or password.");
        setLoading(false);
        return;
      }

      await fetch("/api/auth/ensure-profile", { method: "POST" }).catch(() => undefined);

      if (redirectAfterLogin) {
        router.push(redirectAfterLogin);
        return;
      }

      if (data.user.user_metadata?.is_admin === true) {
        router.push("/admin");
        return;
      }

      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("profile_completed")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (companyError) {
        toast.error("Network error.");
        setLoading(false);
        return;
      }

      router.push(company?.profile_completed ? "/dashboard" : "/signup/company");
    } catch {
      toast.error("Network error.");
      setLoading(false);
    }
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
                Brand Security &amp; GS1 Traceability
              </h1>
              <p className="mt-6 text-base leading-8 text-blue-50 lg:text-lg">
                Protect pharmaceutical products against counterfeit using GS1 compliant serialization,
                QR codes and end-to-end supply chain traceability.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              {[
                { label: "GS1 Compliant", icon: <QrCode className="h-4 w-4" aria-hidden="true" /> },
                { label: "CDSCO Ready", icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" /> },
                { label: "Cloud SaaS", icon: <Cloud className="h-4 w-4" aria-hidden="true" /> },
              ].map((badge) => (
                <span
                  key={badge.label}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur"
                >
                  <Check className="h-4 w-4 text-blue-100" aria-hidden="true" />
                  {badge.icon}
                  {badge.label}
                </span>
              ))}
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
              <div className="mb-8 text-center">
                <h2 className="text-3xl font-bold tracking-normal text-slate-950">Welcome Back</h2>
                <p className="mt-2 text-sm text-slate-500">Sign in to your RxTrace account</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <AuthInput
                  id="company-email"
                  label="Company Email"
                  type="email"
                  value={email}
                  placeholder="name@company.com"
                  autoComplete="email"
                  disabled={loading}
                  error={fieldErrors.email}
                  icon={<Mail className="h-5 w-5" aria-hidden="true" />}
                  onChange={setEmail}
                />

                <AuthInput
                  id="password"
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  placeholder="Enter your password"
                  autoComplete={rememberMe ? "current-password" : "off"}
                  disabled={loading}
                  error={fieldErrors.password}
                  icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
                  action={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-slate-500 transition hover:bg-slate-100 hover:text-[#0F4C81] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      disabled={loading}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-5 w-5" aria-hidden="true" />
                      )}
                    </button>
                  }
                  onChange={setPassword}
                />

                <div className="flex items-center justify-between gap-4">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0F4C81] focus:ring-[#1E88E5]"
                      disabled={loading}
                    />
                    Remember Me
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-sm font-semibold text-[#0F4C81] transition hover:text-[#0A3B63] hover:underline"
                  >
                    Forgot Password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Signing In...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </form>

              <div className="my-7 flex items-center gap-4">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-bold text-slate-400">OR</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <Link
                href="/signup"
                className="flex h-12 w-full items-center justify-center rounded-[10px] border border-[#0F4C81] bg-white px-5 text-sm font-bold text-[#0F4C81] transition hover:bg-[#EAF4FF] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15"
              >
                Create New Account
              </Link>
            </div>

            <footer className="mt-6 text-center text-xs leading-6 text-slate-500">
              <p>By signing in you agree to RxTrace Terms &amp; Privacy Policy.</p>
              <p className="font-semibold text-slate-600">
                &copy; 2026 RxTrace &bull; GS1 Compliant Platform
              </p>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginContent />
    </Suspense>
  );
}

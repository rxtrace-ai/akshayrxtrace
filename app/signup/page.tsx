"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

type FieldProps = {
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
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function Field({
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
}: FieldProps) {
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

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const label = score <= 1 ? "Weak" : score <= 3 ? "Good" : "Strong";
  const color = score <= 1 ? "bg-red-500" : score <= 3 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="grid grid-cols-4 gap-2">
        {checks.map((passed, index) => (
          <div
            key={index}
            className={cn("h-1.5 rounded-full bg-slate-200", index < score && color)}
          />
        ))}
      </div>
      <p className="text-xs font-medium text-slate-500">Password strength: {label}</p>
    </div>
  );
}

function ProgressIndicator() {
  return (
    <div className="mb-8">
      <p className="mb-3 text-center text-sm font-bold text-[#0F4C81]">Step 1 of 3</p>
      <div className="grid grid-cols-3 gap-3">
        {["Step 1", "Step 2", "Step 3"].map((step, index) => (
          <div key={step} className="space-y-2">
            <div
              className={cn(
                "h-2 rounded-full",
                index === 0 ? "bg-[#0F4C81]" : "bg-slate-200"
              )}
            />
            <p
              className={cn(
                "text-center text-xs font-semibold",
                index === 0 ? "text-[#0F4C81]" : "text-slate-400"
              )}
            >
              {step}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    terms: "",
  });

  const normalizedEmail = email.trim().toLowerCase();

  const formValid = useMemo(() => {
    return (
      fullName.trim().length >= 3 &&
      emailPattern.test(normalizedEmail) &&
      passwordPattern.test(password) &&
      password === confirmPassword &&
      acceptedTerms
    );
  }, [acceptedTerms, confirmPassword, fullName, normalizedEmail, password]);

  const validateForm = () => {
    const nextErrors = {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      terms: "",
    };

    if (fullName.trim().length < 3) {
      nextErrors.fullName = "Please enter your full name.";
    }

    if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = "Enter a valid company email.";
    }

    if (!passwordPattern.test(password)) {
      nextErrors.password = "Password must contain 8 characters, 1 uppercase and 1 number.";
    }

    if (password !== confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    if (!acceptedTerms) {
      nextErrors.terms = "Please accept the Terms.";
    }

    setErrors(nextErrors);
    return Object.values(nextErrors).every((message) => !message);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const checkResponse = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const checkPayload = await checkResponse.json();

      if (!checkResponse.ok) {
        toast.error(checkPayload?.error?.message || "Unable to check email. Please try again.");
        setLoading(false);
        return;
      }

      if (checkPayload?.data?.exists) {
        setErrors((current) => ({
          ...current,
          email: "Account already exists. Please sign in.",
        }));
        toast.error("Email already registered.");
        setLoading(false);
        return;
      }

      const otpResponse = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const otpPayload = await otpResponse.json().catch(() => ({}));

      if (!otpResponse.ok) {
        toast.error(otpPayload?.error?.message || "Unable to send OTP. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("rxtrace_signup_email", normalizedEmail);
      localStorage.setItem("rxtrace_signup_full_name", fullName.trim());
      localStorage.setItem("rxtrace_signup_password", password);

      router.push(`/signup/verify?email=${encodeURIComponent(normalizedEmail)}`);
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
                Create Your RxTrace Account
              </h1>
              <p className="mt-6 text-base leading-8 text-blue-50 lg:text-lg">
                Start your 30-day free enterprise trial in less than 2 minutes.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              {["GS1 Compliant", "No Credit Card", "30-Day Trial"].map((badge) => (
                <span
                  key={badge}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur"
                >
                  <Check className="h-4 w-4 text-blue-100" aria-hidden="true" />
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <p className="text-sm font-medium text-blue-100">&copy; 2026 RxTrace</p>
        </aside>

        <section className="flex min-h-screen items-center justify-center px-6 py-8 sm:px-8 md:px-10">
          <div className="w-full max-w-[460px]">
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
              <ProgressIndicator />

              <div className="mb-8 text-center">
                <h2 className="text-3xl font-bold tracking-normal text-slate-950">Create Account</h2>
                <p className="mt-2 text-sm text-slate-500">Verify your email before company setup</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <Field
                  id="full-name"
                  label="Full Name *"
                  type="text"
                  value={fullName}
                  placeholder="Enter your full name"
                  autoComplete="name"
                  disabled={loading}
                  error={errors.fullName}
                  icon={<User className="h-5 w-5" aria-hidden="true" />}
                  onChange={setFullName}
                />

                <Field
                  id="official-email"
                  label="Official Email *"
                  type="email"
                  value={email}
                  placeholder="name@company.com"
                  autoComplete="email"
                  disabled={loading}
                  error={errors.email}
                  icon={<Mail className="h-5 w-5" aria-hidden="true" />}
                  onChange={(value) => setEmail(value.toLowerCase())}
                />

                <div className="space-y-3">
                  <Field
                    id="create-password"
                    label="Create Password *"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    placeholder="Create a secure password"
                    autoComplete="new-password"
                    disabled={loading}
                    error={errors.password}
                    icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
                    action={
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-slate-500 transition hover:bg-slate-100 hover:text-[#0F4C81] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        disabled={loading}
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    }
                    onChange={setPassword}
                  />
                  <PasswordStrength password={password} />
                </div>

                <Field
                  id="confirm-password"
                  label="Confirm Password *"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                  disabled={loading}
                  error={errors.confirmPassword}
                  icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
                  action={
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-slate-500 transition hover:bg-slate-100 hover:text-[#0F4C81] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      disabled={loading}
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  }
                  onChange={setConfirmPassword}
                />

                <div>
                  <label className="flex items-start gap-3 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0F4C81] focus:ring-[#1E88E5]"
                      disabled={loading}
                    />
                    <span>
                      I agree to the RxTrace Terms of Service and Privacy Policy.
                    </span>
                  </label>
                  {errors.terms ? (
                    <p className="mt-2 text-sm font-medium text-red-600">{errors.terms}</p>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={loading || !formValid}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Sending OTP...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Continue &amp; Send OTP
                    </>
                  )}
                </button>
              </form>

              <p className="mt-7 text-center text-sm text-slate-500">
                Already have an account?{" "}
                <Link href="/login" className="font-bold text-[#0F4C81] hover:text-[#0A3B63] hover:underline">
                  Sign In
                </Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

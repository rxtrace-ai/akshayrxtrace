<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
import { redirect } from "next/navigation";

export default function LegacySignupRedirectPage() {
  redirect("/signup");
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { getAppUrl } from "@/lib/config";
import { supabaseClient } from "@/lib/supabase/client";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUp() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!fullName.trim()) return setError("Full name is required.");
    if (!emailPattern.test(email.trim())) return setError("Enter a valid company email.");
    if (password.length < 8) return setError("Password must be at least 8 characters long.");

    setLoading(true);
    try {
      const { data: authResponse, error: signUpError } = await supabaseClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${getAppUrl()}/auth/callback?next=/onboarding/company-setup`,
        },
      });

      if (signUpError) {
        setError(signUpError.message.toLowerCase().includes("already registered") ? "This email is already registered. Please sign in instead." : signUpError.message);
        return;
      }
      if (!authResponse.user) {
        setError("Signup failed. Please try again.");
        return;
      }

      const otpResponse = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!otpResponse.ok) {
        const otpError = await otpResponse.json();
        setError(`Failed to send verification code: ${otpError.error || "Unknown error"}`);
        return;
      }

      localStorage.setItem("pending_verification_email", email.trim());
      localStorage.setItem("pending_user_name", fullName.trim());
      localStorage.setItem("pending_verification_password", password);
      router.push(`/auth/verify?email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPageShell>
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_24px_70px_rgba(15,76,129,0.14)] sm:p-8">
        <header className="mb-7 text-center">
          <h1 className="text-3xl font-bold text-slate-950">Create Your Account</h1>
          <p className="mt-2 text-sm text-slate-500">Start your 3-day trial with RxTrace.</p>
        </header>

        {error ? <div role="alert" className="mb-5 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <AuthField id="full-name" label="Full Name" icon={<UserRound className="h-5 w-5" />} value={fullName} onChange={setFullName} placeholder="Your full name" autoComplete="name" disabled={loading} />
          <AuthField id="company-email" label="Company Email" icon={<Mail className="h-5 w-5" />} value={email} onChange={setEmail} placeholder="name@company.com" autoComplete="email" type="email" disabled={loading} />
          <AuthField id="new-password" label="Password" icon={<LockKeyhole className="h-5 w-5" />} value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" type={showPassword ? "text" : "password"} disabled={loading} action={<button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] text-slate-500 hover:bg-slate-100" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>} />
          <p className="-mt-2 text-xs text-slate-500">Use at least 8 characters.</p>

          <div className="rounded-[10px] border border-[#1E88E5]/20 bg-[#EAF4FF] p-4 text-sm text-slate-700">
            <p className="font-semibold text-[#0F4C81]">Email verification required</p>
            <p className="mt-1">We&apos;ll email you a 6-digit verification code.</p>
          </div>
          <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-70">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating Account...</> : "Create Account"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">Already have an account? <Link href="/login" className="font-semibold text-[#0F4C81] hover:underline">Sign In</Link></p>
      </section>
    </AuthPageShell>
  );
>>>>>>> theirs
}

type AuthFieldProps = { id: string; label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; type?: string; disabled: boolean; action?: React.ReactNode };
function AuthField({ id, label, icon, value, onChange, placeholder, autoComplete, type = "text", disabled, action }: AuthFieldProps) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}</label><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} required className="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50" />{action}</div></div>;
}

type AuthFieldProps = { id: string; label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; type?: string; disabled: boolean; action?: React.ReactNode };
function AuthField({ id, label, icon, value, onChange, placeholder, autoComplete, type = "text", disabled, action }: AuthFieldProps) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}</label><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} required className="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50" />{action}</div></div>;
}

type AuthFieldProps = { id: string; label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; type?: string; disabled: boolean; action?: React.ReactNode };
function AuthField({ id, label, icon, value, onChange, placeholder, autoComplete, type = "text", disabled, action }: AuthFieldProps) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}</label><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} required className="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50" />{action}</div></div>;
}

type AuthFieldProps = { id: string; label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; type?: string; disabled: boolean; action?: React.ReactNode };
function AuthField({ id, label, icon, value, onChange, placeholder, autoComplete, type = "text", disabled, action }: AuthFieldProps) {
  return <div className="space-y-2"><label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}</label><div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} required className="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-12 text-[15px] text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50" />{action}</div></div>;
}

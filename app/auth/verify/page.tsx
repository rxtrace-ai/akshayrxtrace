import { redirect } from "next/navigation";

<<<<<<< ours
type LegacyVerifyRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
=======
import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { Mail, CheckCircle, Loader2, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabase/client';
import { useQueryParams } from '@/lib/hooks/useQueryParams';
>>>>>>> theirs

export default async function LegacyVerifyRedirectPage({ searchParams }: LegacyVerifyRedirectPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const email = resolvedSearchParams.email;
  const emailValue = Array.isArray(email) ? email[0] : email;

<<<<<<< ours
  redirect(emailValue ? `/signup/verify?email=${encodeURIComponent(emailValue)}` : "/signup/verify");
=======
  useEffect(() => {
    // Get email from URL params or localStorage
    const emailParam = query.get('email');
    if (emailParam) {
      setEmail(emailParam);
      localStorage.setItem('pending_verification_email', emailParam);
    } else {
      const storedEmail = localStorage.getItem('pending_verification_email');
      if (storedEmail) setEmail(storedEmail);
      else {
        setError('Email address is missing. Please sign up again.');
      }
    }
  }, [query]);

  // Countdown timer for resend button
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleOTPChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '');
    
    if (digit.length > 1) return; // Prevent multiple digits
    
    const newOTP = [...otp];
    newOTP[index] = digit;
    setOTP(newOTP);
    setError(''); // Clear error on input
    
    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    // Handle paste
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newOTP = pastedData.split('').concat(Array(6).fill('')).slice(0, 6);
    setOTP(newOTP);
    
    // Focus last filled input or first empty
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const otpString = otp.join('');
    
    if (!email) {
      setError('Email address is missing. Please sign up again.');
      return;
    }

    if (otpString.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Verify OTP via API
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otpString }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Verification failed');
        setLoading(false);
        // Clear OTP on error
        setOTP(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
        return;
      }

      // 2. Try to auto sign-in using stored credentials
      const pendingPassword = localStorage.getItem('pending_verification_password') || '';

      // Clear stored values regardless of outcome
      localStorage.removeItem('pending_verification_email');
      localStorage.removeItem('pending_user_name');
      localStorage.removeItem('pending_verification_password');

      if (pendingPassword) {
        const { error: signInError } = await supabaseClient().auth.signInWithPassword({
          email,
          password: pendingPassword,
        });

        if (signInError) {
          // If sign-in fails, send user to signin page
          router.replace('/login?verified=1');
          return;
        }
      }

      await fetch('/api/auth/ensure-profile', { method: 'POST' }).catch(() => undefined);

      // 3. Resolve authenticated user and route by owner company presence.
      const { data: userData, error: userError } = await supabaseClient().auth.getUser();
      if (userError || !userData?.user?.id) {
        router.replace('/login?verified=1');
        return;
      }

      const { data: ownerCompany } = await supabaseClient()
        .from('companies')
        .select('id')
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (ownerCompany?.id) {
        router.replace('/dashboard');
        return;
      }

      router.replace('/onboarding/company-setup');
    } catch (error) {
      console.error('Verification error:', error);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
      setOTP(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  };

  const handleResendOTP = async () => {
    if (!email) {
      setError('Email address is missing');
      return;
    }

    if (countdown > 0) {
      setError(`Please wait ${countdown} seconds before requesting a new code`);
      return;
    }

    setResendLoading(true);
    setResendMessage('');
    setError('');

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setResendMessage('New OTP sent! Check your email.');
        setCountdown(60); // Reset countdown
        setOTP(['', '', '', '', '', '']); // Clear OTP inputs
        inputRefs.current[0]?.focus();
        setTimeout(() => setResendMessage(''), 5000);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to resend OTP');
      }
    } catch (error) {
      setError('Failed to resend OTP. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <AuthPageShell>
      <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-[0_24px_70px_rgba(15,76,129,0.14)] sm:p-8">
        <header className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF4FF] text-[#0F4C81]">
            <Mail className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Verify Your Email</h1>
          <p className="mt-2 text-sm text-slate-500">We sent a 6-digit verification code to</p>
          <p className="mt-1 break-all text-sm font-semibold text-[#0F4C81]">{email || 'your email address'}</p>
        </header>

        {error ? <div role="alert" className="mb-5 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div> : null}
        {resendMessage ? <div role="status" className="mb-5 rounded-[10px] border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">{resendMessage}</div> : null}

        <form onSubmit={handleVerifyOTP} className="space-y-6">
          <div>
            <label className="mb-4 block text-center text-sm font-semibold text-slate-800">Enter verification code</label>
            <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
              {otp.map((digit, index) => <input key={index} ref={(element) => { inputRefs.current[index] = element; }} type="text" inputMode="numeric" maxLength={1} value={digit} onChange={(event) => handleOTPChange(index, event.target.value)} onKeyDown={(event) => handleKeyDown(index, event)} className="h-12 w-10 rounded-[10px] border border-slate-200 text-center text-xl font-bold text-slate-950 outline-none transition focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 sm:h-14 sm:w-12" disabled={loading} autoFocus={index === 0} aria-label={`Verification digit ${index + 1}`} />)}
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">Tip: You can paste the entire code.</p>
          </div>

          <button type="submit" disabled={loading || otp.join('').length !== 6} className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0F4C81] px-5 text-sm font-bold text-white shadow-lg shadow-[#0F4C81]/20 transition hover:bg-[#0A3B63] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/20 disabled:cursor-not-allowed disabled:opacity-70">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Verifying...</> : <><CheckCircle className="h-4 w-4" />Verify & Continue</>}
          </button>
        </form>

        <div className="mt-6 rounded-[10px] border border-[#1E88E5]/20 bg-[#EAF4FF] p-4 text-sm text-slate-700">
          <p className="flex items-center gap-2 font-semibold text-[#0F4C81]"><ShieldCheck className="h-4 w-4" />Check your inbox and spam folder</p>
          <p className="mt-1">Your verification code expires in 10 minutes.</p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-600">Didn&apos;t receive the code?</p>
          <button type="button" onClick={handleResendOTP} disabled={resendLoading || countdown > 0} className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#0F4C81] px-4 text-sm font-bold text-[#0F4C81] transition hover:bg-[#EAF4FF] focus:outline-none focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:opacity-60">
            {resendLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Sending...</> : countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
          </button>
        </div>
        <div className="mt-6 border-t border-slate-200 pt-5 text-center"><Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-[#0F4C81] hover:underline"><ArrowLeft className="h-4 w-4" />Back to Sign In</Link></div>
      </section>
    </AuthPageShell>
  );
}

export default function VerifyOTP() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white"><Loader2 className="h-8 w-8 animate-spin text-[#0F4C81]" /></div>
    }>
      <VerifyOTPContent />
    </Suspense>
  );
>>>>>>> theirs
}

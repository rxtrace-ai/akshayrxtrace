'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, CheckCircle, Loader2, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabase/client';
import { useQueryParams } from '@/lib/hooks/useQueryParams';

function VerifyOTPContent() {
  const router = useRouter();
  const query = useQueryParams();
  
  const [email, setEmail] = useState('');
  const [otp, setOTP] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <Mail className="h-10 w-10 text-orange-500" />
          </div>
          <CardTitle className="text-3xl font-bold text-[#0052CC]">Verify Your Email</CardTitle>
          <p className="text-gray-600 mt-2">
            We&apos;ve sent a 6-digit code to
          </p>
          <p className="text-lg font-semibold text-[#0052CC] break-all mt-1">
            {email || 'your email address'}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {resendMessage && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              {resendMessage}
            </div>
          )}

          <form onSubmit={handleVerifyOTP} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                Enter 6-Digit Verification Code
              </label>
              <div className="flex justify-center gap-2 md:gap-3" onPaste={handlePaste}>
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOTPChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className="w-12 h-14 md:w-14 md:h-16 text-center text-2xl font-bold border-2 rounded-lg focus:border-[#0052CC] focus:outline-none focus:ring-2 focus:ring-[#0052CC]/20 transition-all"
                    disabled={loading}
                    autoFocus={index === 0}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 text-center mt-3">
                Tip: You can paste the entire code
              </p>
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white py-6 text-lg font-semibold shadow-lg"
              disabled={loading || otp.join('').length !== 6}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Verify & Continue
                </>
              )}
            </Button>
          </form>

          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="bg-green-100 rounded-full p-1">
                <CheckCircle className="h-4 w-4 text-green-600" />
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                Check your email inbox <span className="font-semibold">and spam folder</span>
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-green-100 rounded-full p-1">
                <CheckCircle className="h-4 w-4 text-green-600" />
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                Code expires in <span className="font-semibold text-orange-600">10 minutes</span>
              </p>
            </div>
          </div>

          <div className="text-center space-y-3">
            <p className="text-sm text-gray-600">
              Didn&apos;t receive the code?
            </p>
            <Button
              variant="outline"
              onClick={handleResendOTP}
              disabled={resendLoading || countdown > 0}
              className="w-full text-[#0052CC] border-[#0052CC] hover:bg-blue-50"
            >
              {resendLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : countdown > 0 ? (
                `Resend in ${countdown}s`
              ) : (
                'Resend Code'
              )}
            </Button>
          </div>

          <div className="text-center pt-4 border-t border-gray-200">
            <a
              href="/login"
              className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-[#0052CC] hover:underline transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyOTP() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-orange-50">
        <div className="animate-pulse">
          <Loader2 className="h-8 w-8 animate-spin text-[#0052CC]" />
        </div>
      </div>
    }>
      <VerifyOTPContent />
    </Suspense>
  );
}

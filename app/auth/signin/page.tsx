// app/auth/signin/page.tsx
'use client';
import { useState } from 'react';
import { supabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useRouter } from 'next/navigation';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const router = useRouter();
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

  const getSafePath = (value: string | null): string | null => {
    if (!value) return null;
    if (!value.startsWith('/') || value.startsWith('//')) return null;
    return value;
  };
  
  // Show error from URL params (e.g., from callback)
  useState(() => {
    const urlError = searchParams.get('error');
    if (urlError) {
      setError(decodeURIComponent(urlError));
    }
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const { data, error: signInError } = await supabaseClient().auth.signInWithPassword({ 
        email, 
        password 
      });
      
      if (signInError) {
        console.error('Sign in error:', signInError);
        
        // Handle specific error cases
        if (signInError.message.includes('Email not confirmed')) {
          setError('Please verify your email before signing in. Check your inbox for the verification link.');
        } else if (signInError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please check your credentials and try again.');
        } else {
          setError(signInError.message);
        }
        setLoading(false);
        return;
      }
      
      if (data?.user) {
        // Ensure profile row exists for dashboard joins.
        await fetch('/api/auth/ensure-profile', { method: 'POST' }).catch(() => undefined);

        // Honor ?redirect= and legacy ?next= for deep-link flows (e.g. invite accept)
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const redirectPath = getSafePath(urlParams?.get('redirect') ?? null) ?? getSafePath(urlParams?.get('next') ?? null);
        if (redirectPath) {
          router.push(redirectPath);
          return;
        }

        // If user is admin (by metadata), they can go to /admin; admin layout will enforce
        const isAdmin = data.user.user_metadata?.is_admin === true;
        if (isAdmin) {
          router.push('/admin');
          return;
        }

        // Production fix: Send user to dashboard; middleware decides redirect (company-setup if no company / profile not completed, pricing if subscription expired). Avoids wrong redirect to company-setup when resolution API returns null for users who already completed setup.
        router.push('/dashboard');
      } else {
        console.error('No user data returned');
        setError('Sign in failed. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Unexpected error during sign in:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        setError('Failed to send reset email: ' + String(payload?.error || 'Unknown error'));
        setLoading(false);
        return;
      }

      setResetEmailSent(true);
      setLoading(false);
    } catch (err) {
      console.error('Unexpected error during password reset:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to send reset email: ' + errorMsg);
      setLoading(false);
    }
  };

  return (
    <Card className="p-8 shadow-2xl">
      <h1 className="text-3xl font-bold text-center mb-8 text-[#0052CC]">
        {forgotPasswordMode ? 'Reset Password' : 'Welcome Back'}
      </h1>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {resetEmailSent && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <p className="font-semibold mb-2">Reset Email Sent!</p>
          <p className="text-sm">Check your email for a password reset link.</p>
        </div>
      )}
      
      {forgotPasswordMode ? (
        <form onSubmit={handleForgotPassword} className="space-y-6">
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Enter your email address and we&apos;ll send you a link to reset your password.
            </p>
            <Input 
              type="email" 
              placeholder="Email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
              disabled={loading || resetEmailSent}
            />
          </div>
          
          {!resetEmailSent && (
            <Button 
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600" 
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          )}

          <button
            type="button"
            onClick={() => {
              setForgotPasswordMode(false);
              setResetEmailSent(false);
              setError('');
            }}
            className="w-full text-[#0052CC] font-semibold hover:underline"
          >
            Back to Sign In
          </button>
        </form>
      ) : (
        <form onSubmit={handleLogin} className="space-y-6">
          <Input 
            type="email" 
            placeholder="Email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            disabled={loading}
          />
          <Input 
            type="password" 
            placeholder="Password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            disabled={loading}
          />
          
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setForgotPasswordMode(true)}
              className="text-sm text-[#0052CC] hover:underline"
            >
              Forgot Password?
            </button>
          </div>

          <Button 
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-600" 
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      )}
      
      <p className="text-center mt-6 text-gray-600">
        Don&apos;t have an account? <a href="/auth/signup" className="text-[#0052CC] font-semibold hover:underline">Register your company</a>
      </p>
    </Card>
  );
}

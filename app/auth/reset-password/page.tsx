'use client';

import { useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const initializeRecoverySession = async () => {
      try {
        const client = supabaseClient();
        const { data: sessionData } = await client.auth.getSession();
        if (sessionData.session) {
          if (mounted) {
            setSessionReady(true);
            setInitializing(false);
          }
          return;
        }

        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type');
        const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
        const hashAccessToken = hashParams.get('access_token');
        const hashRefreshToken = hashParams.get('refresh_token');
        const hashType = hashParams.get('type');

        if (code) {
          const { error: codeError } = await client.auth.exchangeCodeForSession(code);
          if (codeError) {
            if (mounted) {
              setError('Reset link is invalid or expired. Please request a new one.');
            }
          } else if (mounted) {
            setSessionReady(true);
          }
        } else if (tokenHash && type === 'recovery') {
          const { error: otpError } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (otpError) {
            if (mounted) {
              setError('Reset link is invalid or expired. Please request a new one.');
            }
          } else if (mounted) {
            setSessionReady(true);
          }
        } else if (hashAccessToken && hashRefreshToken && hashType === 'recovery') {
          const { error: sessionError } = await client.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });
          if (sessionError) {
            if (mounted) {
              setError('Reset link is invalid or expired. Please request a new one.');
            }
          } else if (mounted) {
            setSessionReady(true);
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
          }
        } else if (mounted) {
          setError('Reset link is invalid or missing. Please request a new one.');
        }
      } catch {
        if (mounted) {
          setError('Failed to validate reset session. Please request a new link.');
        }
      } finally {
        if (mounted) {
          setInitializing(false);
        }
      }
    };

    initializeRecoverySession();
    return () => {
      mounted = false;
    };
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!sessionReady) {
      setError('Auth session missing. Please open the latest reset link from your email.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabaseClient().auth.updateUser({
        password: password
      });

      if (updateError) {
        console.error('Password update error:', updateError);
        setError(updateError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);

      // Redirect to signin after 3 seconds
      setTimeout(() => {
        router.push('/auth/signin');
      }, 3000);
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('Failed to reset password. Please try again.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card className="p-8 shadow-2xl text-center">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        <h1 className="text-3xl font-bold mb-4 text-green-600">Password Reset Successful!</h1>
        <p className="text-gray-600 mb-6">
          Your password has been updated successfully.
        </p>
        <p className="text-sm text-gray-500">
          Redirecting to sign in page...
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-8 shadow-2xl">
      <h1 className="text-3xl font-bold text-center mb-2 text-[#0052CC]">Reset Password</h1>
      <p className="text-center text-gray-600 mb-8">Enter your new password</p>
      {initializing ? <p className="text-center text-sm text-gray-500 mb-4">Validating reset link...</p> : null}
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <form onSubmit={handleResetPassword} className="space-y-6">
        <div>
          <Input 
            type="password" 
            placeholder="New Password (min 8 characters)" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            minLength={8}
            disabled={loading || initializing || !sessionReady}
          />
        </div>
        
        <div>
          <Input 
            type="password" 
            placeholder="Confirm New Password" 
            value={confirmPassword} 
            onChange={(e) => setConfirmPassword(e.target.value)} 
            required 
            minLength={8}
            disabled={loading || initializing || !sessionReady}
          />
        </div>
        
        <Button 
          type="submit"
          className="w-full bg-orange-500 hover:bg-orange-600" 
          disabled={loading || initializing || !sessionReady}
        >
          {loading ? 'Resetting Password...' : 'Reset Password'}
        </Button>
      </form>
      
      <p className="text-center mt-6 text-gray-600">
        Remember your password? <a href="/auth/signin" className="text-[#0052CC] font-semibold hover:underline">Sign In</a>
      </p>
    </Card>
  );
}

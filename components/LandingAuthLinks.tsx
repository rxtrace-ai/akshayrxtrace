'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabase/client';

type Props = {
  loginClassName?: string;
  registerClassName?: string;
  dashboardClassName?: string;
  logoutClassName?: string;
};

export default function LandingAuthLinks({
  loginClassName,
  registerClassName,
  dashboardClassName,
  logoutClassName,
}: Props) {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const { data } = await supabaseClient().auth.getSession();
      if (!isMounted) return;
      setHasSession(Boolean(data.session));
    }

    load();

    const {
      data: { subscription },
    } = supabaseClient().auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function onLogout() {
    try {
      setSigningOut(true);
      await supabaseClient().auth.signOut();
      setHasSession(false);
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  if (hasSession === null) {
    return (
      <>
        <Link href="/login" className={loginClassName}>
          Log in
        </Link>
        <Link href="/auth/signup" className={registerClassName}>
          Start Trial
        </Link>
      </>
    );
  }

  if (!hasSession) {
    return (
      <>
        <Link href="/login" className={loginClassName}>
          Log in
        </Link>
        <Link href="/auth/signup" className={registerClassName}>
          Start Trial
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard" className={dashboardClassName ?? loginClassName}>
        Dashboard
      </Link>
      <button
        type="button"
        onClick={onLogout}
        className={logoutClassName ?? registerClassName}
        disabled={signingOut}
      >
        {signingOut ? 'Signing out...' : 'Log out'}
      </button>
    </>
  );
}

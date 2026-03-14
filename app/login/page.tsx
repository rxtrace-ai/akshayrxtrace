"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite_token");

  useEffect(() => {
    const redirectTarget = inviteToken
      ? `/accept-invite?token=${encodeURIComponent(inviteToken)}`
      : "/dashboard";

    const signInUrl = `/auth/signin?redirect=${encodeURIComponent(redirectTarget)}`;
    router.replace(signInUrl);
  }, [inviteToken, router]);

  return null;
}

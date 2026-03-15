"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryParams } from "@/lib/hooks/useQueryParams";

function LoginContent() {
  const router = useRouter();
  const query = useQueryParams();
  const inviteToken = query.get("invite_token");

  useEffect(() => {
    const redirectTarget = inviteToken
      ? `/invite/accept?token=${encodeURIComponent(inviteToken)}`
      : "/dashboard";

    const signInUrl = `/auth/signin?redirect=${encodeURIComponent(redirectTarget)}`;
    router.replace(signInUrl);
  }, [inviteToken, router]);

  return null;
}

export default function LoginRedirectPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}

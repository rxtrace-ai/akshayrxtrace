"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type VerifyState =
  | "loading"
  | "valid"
  | "already_accepted"
  | "revoked"
  | "subscription_inactive"
  | "invalid"
  | "error";

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [state, setState] = useState<VerifyState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function verify() {
      if (!token) {
        setState("invalid");
        return;
      }
      setState("loading");
      setMessage(null);
      try {
        const res = await fetch("/api/invite/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = await res.json();
        if (!payload?.valid) {
          const reason = String(payload?.reason || "invalid invite");
          if (reason === "already accepted") setState("already_accepted");
          else if (reason === "revoked") setState("revoked");
          else if (reason === "subscription inactive") setState("subscription_inactive");
          else setState("invalid");
          return;
        }

        const { data: { user } } = await supabaseClient().auth.getUser();
        if (!user) {
          router.replace(`/login?invite_token=${encodeURIComponent(token)}`);
          return;
        }

        if (mounted) {
          setState("valid");
        }
      } catch (err: any) {
        console.error("Invite acceptance failed:", err);
        if (mounted) {
          setState("error");
        }
      }
    }

    void verify();
    return () => {
      mounted = false;
    };
  }, [router, token]);

  async function acceptInvite() {
    if (!token) {
      setMessage("Invitation token is missing.");
      return;
    }
    setAccepting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to accept invitation");
      }
      router.replace("/dashboard");
    } catch (err: any) {
      setMessage(err?.message || "Unable to accept invitation");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-4">
        <h1 className="text-2xl font-semibold">Accept Invite</h1>
        <p className="text-sm text-gray-500">
          You&apos;re accepting an invitation to join a company workspace on RxTrace.
        </p>

        {state === "loading" && <p className="text-sm text-gray-500">Checking your invite…</p>}
        {state === "already_accepted" && (
          <p className="text-sm text-amber-700">This invite has already been accepted.</p>
        )}
        {state === "revoked" && (
          <p className="text-sm text-rose-700">This invite has been revoked.</p>
        )}
        {state === "subscription_inactive" && (
          <p className="text-sm text-rose-700">The company subscription is inactive.</p>
        )}
        {state === "invalid" && (
          <p className="text-sm text-rose-700">This invite link is invalid.</p>
        )}
        {state === "error" && (
          <p className="text-sm text-rose-700">Unable to verify this invite right now.</p>
        )}

        {message && <p className="text-sm text-rose-700">{message}</p>}

        {state === "valid" && (
          <Button onClick={acceptInvite} disabled={accepting}>
            {accepting ? "Accepting..." : "Accept Invite"}
          </Button>
        )}
      </div>
    </div>
  );
}

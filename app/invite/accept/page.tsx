"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryParams } from "@/lib/hooks/useQueryParams";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

function AcceptSeatInviteInner() {
  const router = useRouter();
  const query = useQueryParams();
  const token = query.get("token") || "";
  const [accepting, setAccepting] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitationEmail, setInvitationEmail] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!token) {
        setError("Invitation token is missing.");
        setLoadingContext(false);
        return;
      }
      setLoadingContext(true);
      setError(null);
      setMessage(null);
      try {
        const [previewRes, userRes] = await Promise.all([
          fetch(`/api/public/seat-invitations/preview?token=${encodeURIComponent(token)}`, {
            cache: "no-store",
          }),
          supabaseClient().auth.getUser(),
        ]);

        const previewPayload = await previewRes.json().catch(() => ({}));
        if (!previewRes.ok) {
          throw new Error(previewPayload.error || "Unable to validate invitation");
        }

        if (!mounted) return;
        setInvitationEmail(String(previewPayload.invitation_email || ""));
        const user = userRes.data.user;
        setIsAuthenticated(Boolean(user));
        setAuthEmail(user?.email ? String(user.email).toLowerCase().trim() : null);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || "Unable to validate invitation");
      } finally {
        if (mounted) setLoadingContext(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [token]);

  async function acceptInvite() {
    if (!token) {
      setError("Invitation token is missing.");
      return;
    }
    setAccepting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/seats/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Unable to accept invitation");
      }
      setMessage("Invitation accepted. Redirecting to dashboard...");
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message || "Unable to accept invitation");
    } finally {
      setAccepting(false);
    }
  }

  async function handleSetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitationEmail) {
      setError("Invitation email is missing.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBootstrapping(true);
    setError(null);
    setMessage(null);
    setExistingAccount(false);

    try {
      const createRes = await fetch("/api/public/seat-invitations/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const createPayload = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        if (String(createPayload.error || "").includes("ACCOUNT_EXISTS")) {
          setExistingAccount(true);
          throw new Error("This invited email already has an account. Please sign in to continue.");
        }
        throw new Error(createPayload.error || "Unable to create account");
      }

      const { error: signInError } = await supabaseClient().auth.signInWithPassword({
        email: invitationEmail,
        password,
      });
      if (signInError) {
        throw new Error(signInError.message || "Unable to sign in with the new password");
      }

      setIsAuthenticated(true);
      setAuthEmail(invitationEmail);
      await acceptInvite();
    } catch (err: any) {
      setError(err?.message || "Unable to set password");
    } finally {
      setBootstrapping(false);
    }
  }

  const emailMismatch = useMemo(() => {
    if (!isAuthenticated || !authEmail || !invitationEmail) return false;
    return authEmail !== invitationEmail;
  }, [isAuthenticated, authEmail, invitationEmail]);

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-4">
        <h1 className="text-2xl font-semibold">Accept Seat Invitation</h1>
        <p className="text-sm text-gray-500">
          Complete invite acceptance to activate your company seat.
        </p>

        {message && <p className="text-sm text-green-700">{message}</p>}
        {error && <p className="text-sm text-rose-700">{error}</p>}

        {loadingContext ? (
          <p className="text-sm text-gray-500">Loading invitation...</p>
        ) : (
          <>
            {!isAuthenticated ? (
              <form className="space-y-3" onSubmit={handleSetPassword}>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Invited Email</label>
                  <Input value={invitationEmail} readOnly disabled />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Set Password</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Confirm Password</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="submit" disabled={bootstrapping || !token || !invitationEmail}>
                    {bootstrapping ? "Setting password..." : "Set Password & Accept Invite"}
                  </Button>
                  {existingAccount && (
                    <Link
                      href={`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
                    >
                      <Button variant="outline" type="button">Sign In</Button>
                    </Link>
                  )}
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  Signed in as <span className="font-medium">{authEmail}</span>
                </p>
                {emailMismatch && (
                  <p className="text-sm text-rose-700">
                    This invite is for <span className="font-medium">{invitationEmail}</span>. Please sign in with that email.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={acceptInvite} disabled={accepting || !token || emailMismatch}>
                    {accepting ? "Accepting..." : "Accept Invitation"}
                  </Button>
                  {emailMismatch && (
                    <Link
                      href={`/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
                    >
                      <Button variant="outline" type="button">Use Different Account</Button>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptSeatInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptSeatInviteInner />
    </Suspense>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

function AcceptSeatInviteInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function acceptInvite() {
    if (!token) {
      setError("Invitation token is missing.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/company/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Unable to accept invitation");
      }
      setMessage("Invitation accepted. Your seat is now active.");
    } catch (err: any) {
      setError(err?.message || "Unable to accept invitation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-4">
        <h1 className="text-2xl font-semibold">Accept Seat Invitation</h1>
        <p className="text-sm text-gray-500">
          Sign in with the invited email, then accept this invitation to activate your seat.
        </p>

        {message && <p className="text-sm text-green-700">{message}</p>}
        {error && <p className="text-sm text-rose-700">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={acceptInvite} disabled={loading || !token}>
            {loading ? "Accepting..." : "Accept Invitation"}
          </Button>
          <Link href={`/auth/signin?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`}>
            <Button variant="outline" type="button">Sign In</Button>
          </Link>
        </div>
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

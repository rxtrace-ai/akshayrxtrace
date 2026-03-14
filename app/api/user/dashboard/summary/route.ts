import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function computeDaysRemaining(trialExpiresAt: string | null): number {
  if (!trialExpiresAt) return 0;
  const expiresAt = new Date(trialExpiresAt);
  const now = new Date();
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
}

function blockReason(state: string, remaining: number): "TRIAL_EXPIRED" | "TRIAL_QUOTA_EXHAUSTED" | null {
  if (state === "TRIAL_EXPIRED") return "TRIAL_EXPIRED";
  if (remaining <= 0) return "TRIAL_QUOTA_EXHAUSTED";
  return null;
}

function trialStatusFromSnapshot(snapshot: Awaited<ReturnType<typeof getCompanyEntitlementSnapshot>>) {
  if (snapshot.state === "TRIAL_CANCELLED") return "cancelled" as const;
  if (snapshot.trial_active) return "active" as const;
  if (snapshot.trial_expires_at) return "expired" as const;
  return "not_started" as const;
}

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolved = await resolveCompanyForUser(supabase, user.id, "id");
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const snapshot = await getCompanyEntitlementSnapshot(
      supabase,
      resolved.companyId,
      new Date().toISOString()
    );

    const generationRemaining = Math.min(
      snapshot.remaining.unit || 0,
      snapshot.remaining.box || 0,
      snapshot.remaining.carton || 0,
      snapshot.remaining.pallet || 0
    );

    return NextResponse.json({
      trial_active: snapshot.trial_active,
      trial_expires_at: snapshot.trial_expires_at,
      trial_status: trialStatusFromSnapshot(snapshot),
      days_remaining: computeDaysRemaining(snapshot.trial_expires_at),
      limits: {
        unit: snapshot.limits.unit || 0,
        box: snapshot.limits.box || 0,
        carton: snapshot.limits.carton || 0,
        pallet: snapshot.limits.pallet || 0,
        seat: snapshot.limits.seat || 0,
        plant: snapshot.limits.plant || 0,
        handset: snapshot.limits.handset || 0,
      },
      usage: {
        unit: snapshot.usage.unit || 0,
        box: snapshot.usage.box || 0,
        carton: snapshot.usage.carton || 0,
        pallet: snapshot.usage.pallet || 0,
        seat: snapshot.usage.seat || 0,
        plant: snapshot.usage.plant || 0,
        handset: snapshot.usage.handset || 0,
      },
      enforcement: {
        generation: {
          allowed: generationRemaining > 0 && snapshot.state !== "TRIAL_EXPIRED",
          reason: blockReason(snapshot.state, generationRemaining),
          remaining: Math.max(generationRemaining, 0),
        },
        seats: {
          allowed: (snapshot.remaining.seat || 0) > 0 && snapshot.state !== "TRIAL_EXPIRED",
          reason: blockReason(snapshot.state, snapshot.remaining.seat || 0),
          remaining: Math.max(snapshot.remaining.seat || 0, 0),
        },
        plants: {
          allowed: (snapshot.remaining.plant || 0) > 0 && snapshot.state !== "TRIAL_EXPIRED",
          reason: blockReason(snapshot.state, snapshot.remaining.plant || 0),
          remaining: Math.max(snapshot.remaining.plant || 0, 0),
        },
      },
    });
  } catch (error: any) {
    console.error("DASHBOARD SUMMARY ERROR:", error);

    return NextResponse.json(
      { error: error?.message ?? "Dashboard summary failed" },
      { status: 500 }
    );
  }
}

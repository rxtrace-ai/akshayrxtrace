import { NextResponse } from "next/server";
import { requireOwnerContext } from "@/lib/billing/userSubscriptionAuth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { error } = await getSupabaseAdmin()
    .from("companies")
    .update({ subscription_page_seen_at: new Date().toISOString() })
    .eq("id", owner.companyId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

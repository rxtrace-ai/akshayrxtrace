import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export type OwnerContext =
  | {
      ok: true;
      userId: string;
      userEmail: string | null;
      companyId: string;
      companyName: string | null;
      supabase: ReturnType<typeof getSupabaseAdmin>;
    }
  | { ok: false; response: NextResponse };

export async function requireOwnerContext(): Promise<OwnerContext> {
  const server = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await server.auth.getUser();

  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = getSupabaseAdmin();
  const resolved = await resolveCompanyForUser(supabase, user.id, "id, company_name");
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: "Company not found" }, { status: 404 }) };
  }
  if (!resolved.isOwner) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return {
    ok: true,
    userId: user.id,
    userEmail: user.email || null,
    companyId: resolved.companyId,
    companyName: (resolved.company as any)?.company_name ?? null,
    supabase,
  };
}


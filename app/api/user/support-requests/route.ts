import { apiJson } from "@/lib/api/response";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return apiJson({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fullName = normalizeText((body as Record<string, unknown>).full_name, 120);
    const email = normalizeText((body as Record<string, unknown>).email, 160).toLowerCase() || (user.email || "").toLowerCase();
    const category = normalizeText((body as Record<string, unknown>).category, 80).toLowerCase();
    const priority = normalizeText((body as Record<string, unknown>).priority, 40).toLowerCase() || "normal";
    const message = normalizeText((body as Record<string, unknown>).message, 4000);

    if (!fullName || !email || !category || !message) {
      return apiJson({ error: "Full name, email, category, and message are required." }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(admin, user.id, "id, company_name");
    if (!resolved) {
      return apiJson({ error: "Company not found" }, { status: 404 });
    }

    const company = resolved.company as Record<string, unknown>;
    const { data, error } = await admin
      .from("support_requests")
      .insert({
        user_id: user.id,
        company_id: resolved.companyId,
        full_name: fullName,
        company_name: String(company.company_name ?? "").trim() || null,
        email,
        category,
        priority: priority === "high" ? "high" : "normal",
        message,
        source: "dashboard_help",
      })
      .select("id, created_at, status")
      .single();

    if (error) {
      return apiJson({ error: error.message }, { status: 500 });
    }

    return apiJson({ success: true, request: data }, { status: 201 });
  } catch (err) {
    return apiJson({ error: err instanceof Error ? err.message : "Failed to submit support request." }, { status: 500 });
  }
}

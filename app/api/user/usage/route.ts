import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { getCompanyEntitlementSnapshot } from "@/lib/entitlement/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(admin, user.id, "id");
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const snapshot = await getCompanyEntitlementSnapshot(admin, resolved.companyId);

    const usage = {
      UNIT: {
        used: snapshot.usage.unit,
        limit_value: snapshot.limits.unit,
        limit_type: "HARD",
        exceeded: snapshot.remaining.unit <= 0,
        percentage:
          snapshot.limits.unit > 0
            ? Math.min(100, Math.round((snapshot.usage.unit / snapshot.limits.unit) * 100))
            : 0,
      },
      BOX: {
        used: snapshot.usage.box,
        limit_value: snapshot.limits.box,
        limit_type: "HARD",
        exceeded: snapshot.remaining.box <= 0,
        percentage:
          snapshot.limits.box > 0
            ? Math.min(100, Math.round((snapshot.usage.box / snapshot.limits.box) * 100))
            : 0,
      },
      CARTON: {
        used: snapshot.usage.carton,
        limit_value: snapshot.limits.carton,
        limit_type: "HARD",
        exceeded: snapshot.remaining.carton <= 0,
        percentage:
          snapshot.limits.carton > 0
            ? Math.min(100, Math.round((snapshot.usage.carton / snapshot.limits.carton) * 100))
            : 0,
      },
      SSCC: {
        used: snapshot.usage.pallet,
        limit_value: snapshot.limits.pallet,
        limit_type: "HARD",
        exceeded: snapshot.remaining.pallet <= 0,
        percentage:
          snapshot.limits.pallet > 0
            ? Math.min(100, Math.round((snapshot.usage.pallet / snapshot.limits.pallet) * 100))
            : 0,
      },
    };

    return NextResponse.json({ success: true, usage, state: snapshot.state });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

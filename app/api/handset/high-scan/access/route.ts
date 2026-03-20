import { NextResponse } from "next/server";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyDeviceAuthToken } from "@/lib/handset-v2/auth";
import { isHandsetV2Enabled } from "@/lib/handset-v2/config";

export async function POST(req: Request) {
  if (!isHandsetV2Enabled()) {
    return NextResponse.json({ success: false, error: "FEATURE_DISABLED" }, { status: 403 });
  }

  const authHeader = req.headers.get("authorization");
  const deviceAuth = await verifyDeviceAuthToken(authHeader);

  if (deviceAuth.ok) {
    const enabled = Boolean((deviceAuth.handset as any).high_scan_enabled);
    return NextResponse.json({
      success: true,
      allowed: enabled,
      handset_id: deviceAuth.handsetId,
      mode: "device_auth",
    });
  }

  const payload = (await req.json().catch(() => ({}))) as { handset_id?: string };
  const handsetId = String(payload.handset_id || "").trim();
  if (!handsetId) {
    return NextResponse.json({ success: false, error: "handset_id is required" }, { status: 400 });
  }

  const companyId = await resolveCompanyIdFromRequest(req);
  if (!companyId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: handset, error } = await supabase
    .from("handsets")
    .select("id, company_id, status, high_scan_enabled, disabled_at")
    .eq("id", handsetId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!handset || handset.company_id !== companyId) {
    return NextResponse.json({ success: false, error: "Handset not found" }, { status: 404 });
  }

  const active = String(handset.status || "").toUpperCase() === "ACTIVE" && !handset.disabled_at;
  return NextResponse.json({
    success: true,
    allowed: active && Boolean(handset.high_scan_enabled),
    handset_id: handset.id,
    mode: "company_user",
  });
}
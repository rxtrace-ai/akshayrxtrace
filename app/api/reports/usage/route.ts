import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);

  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to");     // YYYY-MM-DD

  const {
    data: { user },
    error: authError,
  } = await (await supabaseServer()).auth.getUser();

  if (!user || authError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (companyError) {
    return NextResponse.json({ error: companyError.message }, { status: 500 });
  }

  if (!company?.id) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const companyId = company.id as string;

  const actor = req.headers.get("x-actor") || user.email || user.id;
  const auditBase = {
    companyId,
    actor,
    action: "reports.usage.export",
    integrationSystem: "reports",
    metadata: { from, to },
  } as const;

  /* =====================================================
     FETCH SCAN LOGS
     ===================================================== */

  let query = supabase
    .from("scan_logs")
    .select(
      `
      id,
      raw_scan,
      metadata,
      handset_id,
      scanned_at
      `
    )
    .eq("company_id", companyId)
    .order("scanned_at", { ascending: false });

  if (from) query = query.gte("scanned_at", `${from}T00:00:00`);
  if (to) query = query.lte("scanned_at", `${to}T23:59:59`);

  const { data, error } = await query;

  if (error) {
    try {
      await writeAuditLog({
        ...auditBase,
        status: "failed",
        metadata: { ...auditBase.metadata, error: error.message },
      });
    } catch {
      // do not fail report generation because auditing failed
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  /* =====================================================
     AGGREGATE RESULTS
     ===================================================== */

  const rows = (data || []).map((r) => ({
    scanned_code: r.raw_scan,
    scan_level: r.metadata?.level || "unknown",
    handset_id: r.handset_id,
    scanned_at: r.scanned_at,
  }));

  /* =====================================================
     CSV EXPORT
     ===================================================== */

  const csv = [
    "Scanned Code,Scan Level,Handset ID,Scanned At",
    ...rows.map(
      (r) =>
        `"${r.scanned_code}","${r.scan_level}","${r.handset_id || ""}","${r.scanned_at}"`
    ),
  ].join("\n");

  try {
    await writeAuditLog({
      ...auditBase,
      status: "success",
      metadata: { ...auditBase.metadata, rows: rows.length },
    });
  } catch {
    // do not fail report generation because auditing failed
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=usage_report.csv",
    },
  });
}

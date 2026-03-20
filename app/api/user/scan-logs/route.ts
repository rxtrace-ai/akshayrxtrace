import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanLogRow = {
  id: string;
  scanned_at: string;
  raw_scan: string | null;
  parsed: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
  ip: string | null;
  handset_id: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(value: string | null, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function applyFilters(query: any, params: URLSearchParams) {
  const status = asString(params.get("status")).trim().toUpperCase();
  const from = asString(params.get("from")).trim();
  const to = asString(params.get("to")).trim();
  const q = asString(params.get("q")).trim();

  let next = query;
  if (status) {
    next = next.eq("metadata->>status", status);
  }
  if (from) {
    next = next.gte("scanned_at", `${from}T00:00:00`);
  }
  if (to) {
    next = next.lte("scanned_at", `${to}T23:59:59`);
  }
  if (q) {
    const escaped = q.replace(/,/g, " ");
    next = next.or(
      `raw_scan.ilike.%${escaped}%,parsed->>serialNo.ilike.%${escaped}%,parsed->>serial.ilike.%${escaped}%,parsed->>gtin.ilike.%${escaped}%,parsed->>batchNo.ilike.%${escaped}%,parsed->>batch.ilike.%${escaped}%`
    );
  }
  return next;
}

function normalizeScanLog(row: ScanLogRow) {
  const parsed = row.parsed || {};
  const metadata = row.metadata || {};

  const serial =
    asString((parsed as any).serialNo) ||
    asString((parsed as any).serial) ||
    asString((metadata as any).serial);
  const gtin = asString((parsed as any).gtin);
  const batch = asString((parsed as any).batchNo) || asString((parsed as any).batch);
  const expiry = asString((parsed as any).expiryDate) || asString((parsed as any).expiryYYMMDD);

  return {
    id: row.id,
    scanned_at: row.scanned_at,
    status: asString((metadata as any).status) || asString(row.status) || "UNKNOWN",
    serial,
    gtin,
    batch,
    expiry,
    raw_scan: row.raw_scan || "",
    ip: row.ip || "",
    handset_id: row.handset_id || null,
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await supabaseServer();
    const admin = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolved = await resolveCompanyForUser(admin, user.id, "id");
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const params = new URL(req.url).searchParams;
    const page = Math.max(1, toInt(params.get("page"), 1));
    const limit = Math.max(1, Math.min(200, toInt(params.get("limit"), 50)));
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    const baseQuery = admin
      .from("scan_logs")
      .select("id, scanned_at, raw_scan, parsed, metadata, status, ip, handset_id", { count: "exact" })
      .eq("company_id", resolved.companyId)
      .order("scanned_at", { ascending: false });

    const filtered = applyFilters(baseQuery, params).range(fromIndex, toIndex);
    const { data, error, count } = await filtered;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data || []).map((row) => normalizeScanLog(row as ScanLogRow));
    const total = Number(count || 0);

    return NextResponse.json({
      success: true,
      items,
      page,
      limit,
      total,
      has_more: fromIndex + items.length < total,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch scan logs" }, { status: 500 });
  }
}


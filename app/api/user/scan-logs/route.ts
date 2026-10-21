import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { resolveCompanyForUser } from "@/lib/company/resolve";
import { buildSafeIlikePattern } from "@/lib/api/filter";
import { fail, ok } from "@/lib/api/response";
import { parseExpiryStrict } from "@/lib/scanner/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanLogRow = {
  id: string;
  scanned_at: string | null;
  raw_scan: string | null;
  parsed: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
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
  if (status && /^[A-Z0-9_]{1,32}$/.test(status)) {
    next = next.or(`status.eq.${status},metadata->>status.eq.${status}`);
  }
  if (from) {
    next = next.gte("scanned_at", `${from}T00:00:00`);
  }
  if (to) {
    next = next.lte("scanned_at", `${to}T23:59:59`);
  }
  if (q) {
    const pattern = buildSafeIlikePattern(q, 80);
    if (pattern) {
      next = next.or(
        `raw_scan.ilike.${pattern},parsed->>serialNo.ilike.${pattern},parsed->>serial.ilike.${pattern},parsed->>serial_number.ilike.${pattern},parsed->>21.ilike.${pattern},parsed->>gtin.ilike.${pattern},parsed->>01.ilike.${pattern},parsed->>batchNo.ilike.${pattern},parsed->>batch.ilike.${pattern},parsed->>10.ilike.${pattern}`
      );
    }
  }
  return next;
}

function normalizeScanLog(row: ScanLogRow) {
  const parsedRow = row.parsed || {};
  const parsed = parsedRow.parsed && typeof parsedRow.parsed === "object"
    ? (parsedRow.parsed as Record<string, unknown>)
    : parsedRow;
  const metadata = row.metadata || {};
  const firstString = (...values: unknown[]) => values.find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const serial = firstString(parsed.serialNo, parsed.serial, parsed.serial_number, parsed["21"], parsed["(21)"], (metadata as any).serial) || null;
  const gtin = firstString(parsed.gtin, parsed.gtin14, parsed["01"], parsed["(01)"], (metadata as any).gtin) || null;
  const batch = firstString(parsed.batchNo, parsed.batch, parsed.lot, parsed["10"], parsed["(10)"], (metadata as any).batch) || null;
  const rawExpiry = firstString(parsed.expiryDate, parsed.expiry, parsed.expiryYYMMDD, parsed["17"], parsed["(17)"], (metadata as any).expiry);
  const parsedExpiry = rawExpiry ? parseExpiryStrict(rawExpiry) : null;
  const expiry = parsedExpiry?.ok
    ? `${String(parsedExpiry.day).padStart(2, "0")}-${String(parsedExpiry.month).padStart(2, "0")}-${parsedExpiry.year}`
    : rawExpiry || null;
  const scannedAt = row.scanned_at && Number.isFinite(Date.parse(row.scanned_at)) ? row.scanned_at : null;
  const storedStatus = asString(row.status).toUpperCase();
  const metadataStatus = asString((metadata as any).status).toUpperCase();
  const status = (storedStatus === "SUCCESS" || storedStatus === "FAILED") && metadataStatus
    ? metadataStatus
    : storedStatus || metadataStatus || "UNKNOWN";

  return {
    id: row.id,
    scanned_at: scannedAt,
    status,
    serial_number: serial,
    gtin,
    batch,
    expiry,
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
      return fail("UNAUTHORIZED", "Unauthorized", 401);
    }

    const resolved = await resolveCompanyForUser(admin, user.id, "id");
    if (!resolved) {
      return fail("NOT_FOUND", "Company not found", 404);
    }

    const params = new URL(req.url).searchParams;
    const page = Math.max(1, toInt(params.get("page"), 1));
    const limit = Math.max(1, Math.min(200, toInt(params.get("limit"), 50)));
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    const baseQuery = admin
      .from("scan_logs")
      .select("id, scanned_at, raw_scan, parsed, metadata, status, handset_id", { count: "exact" })
      .eq("company_id", resolved.companyId)
      .order("scanned_at", { ascending: false });

    const filtered = applyFilters(baseQuery, params).range(fromIndex, toIndex);
    const { data, error, count } = await filtered;

    if (error) {
      return fail("INTERNAL_ERROR", error.message, 500);
    }

    const rows = (data || []) as ScanLogRow[];
    const items = rows.map((row) => normalizeScanLog(row));
    const total = Number(count || 0);

    return ok({
      items,
      page,
      limit,
      total,
      has_more: fromIndex + items.length < total,
    });
  } catch (err: any) {
    return fail("INTERNAL_ERROR", err?.message || "Failed to fetch scan logs", 500);
  }
}

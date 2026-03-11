import { NextResponse } from "next/server";
import { Pool } from "pg";
import { parseGS1 } from "@/lib/parseGS1";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rawConnectionString = process.env.DATABASE_URL?.trim();
const parsedConnectionString = rawConnectionString
  ? new URL(rawConnectionString)
  : null;

if (parsedConnectionString) {
  parsedConnectionString.searchParams.delete("sslmode");
  parsedConnectionString.searchParams.delete("ssl");
  parsedConnectionString.searchParams.delete("sslcert");
  parsedConnectionString.searchParams.delete("sslkey");
  parsedConnectionString.searchParams.delete("sslrootcert");
}

const connectionString = parsedConnectionString?.toString();

let pool: Pool | null = null;

if (connectionString) {
  if (!(global as any)._rxtrace_pool) {
    (global as any)._rxtrace_pool = new Pool({
      connectionString,
      max: 3,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  pool = (global as any)._rxtrace_pool;
}

type ExtractedIdentifiers = {
  raw: string;
  sscc: string | null;
  serial: string | null;
};

type TraceabilityRow = {
  match_type: "UNIT" | "BOX" | "CARTON" | "PALLET";
  serial: string | null;
  box_sscc: string | null;
  carton_sscc: string | null;
  pallet_sscc: string | null;
  box_id: string | null;
  carton_id: string | null;
  pallet_id: string | null;
  units_in_box: number | null;
  boxes_in_carton: number | null;
  cartons_in_pallet: number | null;
  units_in_carton: number | null;
  boxes_in_pallet: number | null;
  units_in_pallet: number | null;
};

function extractIdentifiers(input: string): ExtractedIdentifiers {
  const raw = String(input || "").trim();
  if (!raw) {
    return { raw: "", sscc: null, serial: null };
  }

  if (/^\d{18}$/.test(raw)) {
    return { raw, sscc: raw, serial: raw };
  }

  try {
    if (
      raw.includes("(00)") ||
      raw.includes("(21)") ||
      raw.startsWith("00") ||
      raw.startsWith("01")
    ) {
      const parsed = parseGS1(raw);
      return {
        raw,
        sscc: parsed?.sscc || null,
        serial: parsed?.serialNo || raw,
      };
    }
  } catch {}

  return { raw, sscc: null, serial: raw };
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTraceability(row: TraceabilityRow) {
  const counts: Record<string, number> = {};

  if (row.match_type === "UNIT") {
    if (row.units_in_box !== null) counts.units_in_box = row.units_in_box;
    if (row.boxes_in_carton !== null) counts.boxes_in_carton = row.boxes_in_carton;
    if (row.cartons_in_pallet !== null) counts.cartons_in_pallet = row.cartons_in_pallet;
  }

  if (row.match_type === "BOX") {
    if (row.units_in_box !== null) counts.units_in_box = row.units_in_box;
  }

  if (row.match_type === "CARTON") {
    if (row.boxes_in_carton !== null) counts.boxes_in_carton = row.boxes_in_carton;
    if (row.units_in_carton !== null) counts.units_in_carton = row.units_in_carton;
  }

  if (row.match_type === "PALLET") {
    if (row.cartons_in_pallet !== null) counts.cartons_in_pallet = row.cartons_in_pallet;
    if (row.boxes_in_pallet !== null) counts.boxes_in_pallet = row.boxes_in_pallet;
    if (row.units_in_pallet !== null) counts.units_in_pallet = row.units_in_pallet;
  }

  const response: Record<string, unknown> = {
    type: row.match_type,
  };

  if (row.serial) response.serial = row.serial;
  if (row.box_sscc) response.box_sscc = row.box_sscc;
  if (row.carton_sscc) response.carton_sscc = row.carton_sscc;
  if (row.pallet_sscc) response.pallet_sscc = row.pallet_sscc;
  if (Object.keys(counts).length > 0) response.counts = counts;

  return response;
}

const TRACEABILITY_QUERY = `
WITH matched_unit AS (
  SELECT
    1 AS match_priority,
    'UNIT'::text AS match_type,
    u.serial,
    b.sscc AS box_sscc,
    c.sscc AS carton_sscc,
    p.sscc AS pallet_sscc,
    u.box_id,
    b.carton_id,
    p.id AS pallet_id
  FROM labels_units u
  LEFT JOIN boxes b
    ON b.id = u.box_id
   AND b.company_id = $4::uuid
  LEFT JOIN cartons c
    ON c.id = b.carton_id
   AND c.company_id = $4::uuid
  LEFT JOIN pallets p
    ON p.id = COALESCE(c.pallet_id, b.pallet_id)
   AND p.company_id = $4::uuid
  WHERE u.company_id = $4::uuid
    AND ($3::text IS NOT NULL AND u.serial = $3::text)
),
matched_box AS (
  SELECT
    2 AS match_priority,
    'BOX'::text AS match_type,
    NULL::text AS serial,
    b.sscc AS box_sscc,
    c.sscc AS carton_sscc,
    p.sscc AS pallet_sscc,
    b.id AS box_id,
    b.carton_id,
    p.id AS pallet_id
  FROM boxes b
  LEFT JOIN cartons c
    ON c.id = b.carton_id
   AND c.company_id = $4::uuid
  LEFT JOIN pallets p
    ON p.id = COALESCE(c.pallet_id, b.pallet_id)
   AND p.company_id = $4::uuid
  WHERE b.company_id = $4::uuid
    AND (
      ($2::text IS NOT NULL AND b.sscc = $2::text)
      OR b.code = $1::text
    )
),
matched_carton AS (
  SELECT
    3 AS match_priority,
    'CARTON'::text AS match_type,
    NULL::text AS serial,
    NULL::text AS box_sscc,
    c.sscc AS carton_sscc,
    p.sscc AS pallet_sscc,
    NULL::uuid AS box_id,
    c.id AS carton_id,
    p.id AS pallet_id
  FROM cartons c
  LEFT JOIN pallets p
    ON p.id = c.pallet_id
   AND p.company_id = $4::uuid
  WHERE c.company_id = $4::uuid
    AND (
      ($2::text IS NOT NULL AND c.sscc = $2::text)
      OR c.code = $1::text
    )
),
matched_pallet AS (
  SELECT
    4 AS match_priority,
    'PALLET'::text AS match_type,
    NULL::text AS serial,
    NULL::text AS box_sscc,
    NULL::text AS carton_sscc,
    p.sscc AS pallet_sscc,
    NULL::uuid AS box_id,
    NULL::uuid AS carton_id,
    p.id AS pallet_id
  FROM pallets p
  WHERE p.company_id = $4::uuid
    AND ($2::text IS NOT NULL AND p.sscc = $2::text)
),
matched AS (
  SELECT * FROM matched_unit
  UNION ALL
  SELECT * FROM matched_box
  UNION ALL
  SELECT * FROM matched_carton
  UNION ALL
  SELECT * FROM matched_pallet
  ORDER BY match_priority
  LIMIT 1
)
SELECT
  m.match_type,
  m.serial,
  m.box_sscc,
  m.carton_sscc,
  m.pallet_sscc,
  m.box_id,
  m.carton_id,
  m.pallet_id,
  CASE
    WHEN m.box_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM labels_units u
      WHERE u.company_id = $4::uuid
        AND u.box_id = m.box_id
    )
    ELSE NULL
  END AS units_in_box,
  CASE
    WHEN m.carton_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM boxes b
      WHERE b.company_id = $4::uuid
        AND b.carton_id = m.carton_id
    )
    ELSE NULL
  END AS boxes_in_carton,
  CASE
    WHEN m.pallet_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM cartons c
      WHERE c.company_id = $4::uuid
        AND c.pallet_id = m.pallet_id
    )
    ELSE NULL
  END AS cartons_in_pallet,
  CASE
    WHEN m.carton_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM labels_units u
      INNER JOIN boxes b
        ON b.id = u.box_id
       AND b.company_id = $4::uuid
      WHERE u.company_id = $4::uuid
        AND b.carton_id = m.carton_id
    )
    ELSE NULL
  END AS units_in_carton,
  CASE
    WHEN m.pallet_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM boxes b
      LEFT JOIN cartons c
        ON c.id = b.carton_id
       AND c.company_id = $4::uuid
      WHERE b.company_id = $4::uuid
        AND COALESCE(c.pallet_id, b.pallet_id) = m.pallet_id
    )
    ELSE NULL
  END AS boxes_in_pallet,
  CASE
    WHEN m.pallet_id IS NOT NULL THEN (
      SELECT COUNT(*)::int
      FROM labels_units u
      INNER JOIN boxes b
        ON b.id = u.box_id
       AND b.company_id = $4::uuid
      LEFT JOIN cartons c
        ON c.id = b.carton_id
       AND c.company_id = $4::uuid
      WHERE u.company_id = $4::uuid
        AND COALESCE(c.pallet_id, b.pallet_id) = m.pallet_id
    )
    ELSE NULL
  END AS units_in_pallet
FROM matched m;
`;

export async function GET(req: Request) {
  try {
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();
    const requestedCompanyId = searchParams.get("company_id")?.trim();

    if (!code) {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }

    if (!requestedCompanyId) {
      return NextResponse.json({ error: "company_id required" }, { status: 400 });
    }

    if (!UUID_RE.test(requestedCompanyId)) {
      return NextResponse.json({ error: "invalid company_id" }, { status: 400 });
    }

    if (requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!pool) {
      return NextResponse.json(
        { error: "DATABASE_URL not configured" },
        { status: 500 }
      );
    }

    const identifiers = extractIdentifiers(code);

    const result = await pool.query<TraceabilityRow>(TRACEABILITY_QUERY, [
      identifiers.raw,
      identifiers.sscc,
      identifiers.serial,
      requestedCompanyId,
    ]);

    const row = result.rows[0];

    if (!row) {
      return NextResponse.json({ error: "CODE_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(
      buildTraceability({
        ...row,
        units_in_box: toInt(row.units_in_box),
        boxes_in_carton: toInt(row.boxes_in_carton),
        cartons_in_pallet: toInt(row.cartons_in_pallet),
        units_in_carton: toInt(row.units_in_carton),
        boxes_in_pallet: toInt(row.boxes_in_pallet),
        units_in_pallet: toInt(row.units_in_pallet),
      })
    );
  } catch (error: any) {
    console.error("TRACEABILITY ERROR:", error);
    console.error("STACK:", error?.stack);

    return NextResponse.json(
      {
        error: error?.message ?? "Internal server error",
        stack: error?.stack,
      },
      { status: 500 }
    );
  }
}

import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import PDFDocument from "pdfkit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { sanitizeFilterToken } from "@/lib/api/filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(total);
  const out = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);

  const type = searchParams.get("type"); // audit | trace

  const {
    data: { user },
    error: authError,
  } = await (await supabaseServer()).auth.getUser();

  if (!user || authError) {
    return apiJson({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (companyError) {
    return apiJson({ error: companyError.message }, { status: 500 });
  }

  if (!company?.id) {
    return apiJson({ error: "Company not found" }, { status: 404 });
  }

  const companyId = company.id as string;

  /* ======================================================
     1️⃣ AUDIT LOG EXPORT (CSV)
     ====================================================== */
  if (type === "audit") {
    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (searchParams.get("action"))
      query = query.eq("action", searchParams.get("action"));

    if (searchParams.get("status"))
      query = query.eq("status", searchParams.get("status"));

    if (searchParams.get("from"))
      query = query.gte("created_at", searchParams.get("from"));

    if (searchParams.get("to"))
      query = query.lte("created_at", searchParams.get("to"));

    const { data } = await query;

    const csv = [
      "Date,Actor,Action,Status,Integration",
      ...(data || []).map((r) => {
        const createdAt = r.created_at ?? "";
        const actor = r.actor ?? "";
        const action = r.action ?? "";
        const status = r.status ?? "";
        const integration = r.integration_system ?? "";
        return `"${createdAt}","${actor}","${action}","${status}","${integration}"`;
      }),
    ].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=audit_logs.csv",
      },
    });
  }

  /* ======================================================
     2️⃣ TRACEABILITY EXPORT (CSV / PDF)
     ====================================================== */
  if (type === "trace") {
    const code = sanitizeFilterToken(searchParams.get("code"), 120);
    const format = searchParams.get("format"); // csv | pdf

    if (!code || !format) {
      return apiJson(
        { error: "code and format required" },
        { status: 400 }
      );
    }

    const [parentRowsResult, childRowsResult] = await Promise.all([
      supabase
        .from("packaging_hierarchy")
        .select("*")
        .eq("company_id", companyId)
        .eq("parent_code", code),
      supabase
        .from("packaging_hierarchy")
        .select("*")
        .eq("company_id", companyId)
        .eq("child_code", code),
    ]);

    const rows = [...(parentRowsResult.data || []), ...(childRowsResult.data || [])];

    /* ---------- CSV ---------- */
    if (format === "csv") {
      const csv = [
        "Parent Level,Parent Code,Child Level,Child Code,Created At",
        ...(rows || []).map(
          (r) =>
            `"${r.parent_level}","${r.parent_code}","${r.child_level}","${r.child_code}","${r.created_at}"`
        ),
      ].join("\n");

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=trace_${code}.csv`,
        },
      });
    }

    /* ---------- PDF ---------- */
    if (format === "pdf") {
      const pdfBytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40 });
        const chunks: Uint8Array[] = [];

        doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        doc.on("end", () => resolve(concatUint8Arrays(chunks)));
        doc.on("error", reject);

        doc.fontSize(16).text("RxTrace – Traceability Report", {
          align: "center",
        });
        doc.moveDown();
        doc.fontSize(12).text(`Searched Code: ${code}`);
        doc.text(`Generated At: ${new Date().toLocaleString()}`);
        doc.moveDown();

        rows?.forEach((r) => {
          doc
            .fontSize(10)
            .text(
              `${r.parent_level.toUpperCase()} (${r.parent_code}) → ${r.child_level.toUpperCase()} (${r.child_code})`
            );
        });

        doc.end();
      });

      return new Response(pdfBytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename=trace_${code}.pdf`,
        },
      });
    }

    return apiJson({ error: "Invalid format" }, { status: 400 });
  }

  return apiJson(
    { error: "Invalid export type" },
    { status: 400 }
  );
}


import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import PDFDocument from "pdfkit";
import { writeAuditLog } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

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

  const code = searchParams.get("code");
  const format = searchParams.get("format"); // csv | pdf

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
  const actor = req.headers.get("x-actor") || user.email || user.id;
  const auditBase = {
    companyId,
    actor,
    action: "reports.trace.export",
    integrationSystem: "reports",
    metadata: { code, format },
  } as const;

  if (!code || !format) {
    try {
      await writeAuditLog({
        ...auditBase,
        status: "failed",
        metadata: { ...auditBase.metadata, error: "code and format are required" },
      });
    } catch {
      // do not fail response because auditing failed
    }
    return apiJson(
      { error: "code and format are required" },
      { status: 400 }
    );
  }

  /* =====================================================
     🔁 FULL RECURSIVE TRACE (UP + DOWN)
     ===================================================== */

  const { data, error } = await supabase.rpc(
    "full_trace_hierarchy",
    {
      p_company_id: companyId,
      p_code: code,
    }
  );

  if (error) {
    try {
      await writeAuditLog({
        ...auditBase,
        status: "failed",
        metadata: { ...auditBase.metadata, error: error.message },
      });
    } catch {
      // do not fail response because auditing failed
    }
    return apiJson(
      { error: error.message },
      { status: 500 }
    );
  }

  /* ================= CSV EXPORT ================= */
  if (format === "csv") {
    const csv = [
      "Level,Code,Parent Level,Parent Code",
      ...(data || []).map(
        (r: any) =>
          `"${r.level}","${r.code}","${r.parent_level || ""}","${r.parent_code || ""}"`
      ),
    ].join("\n");

    try {
      await writeAuditLog({
        ...auditBase,
        status: "success",
        metadata: { ...auditBase.metadata, rows: (data || []).length },
      });
    } catch {
      // do not fail response because auditing failed
    }

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=trace_${code}.csv`,
      },
    });
  }

  /* ================= PDF EXPORT ================= */
  if (format === "pdf") {
    const pdfBytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const chunks: Uint8Array[] = [];

      doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      doc.on("end", () => resolve(concatUint8Arrays(chunks)));
      doc.on("error", reject);

      doc.fontSize(16).text("RxTrace – Full Traceability Report", {
        align: "center",
      });
      doc.moveDown();

      doc.fontSize(12).text(`Search Code: ${code}`);
      doc.text(`Generated: ${new Date().toLocaleString()}`);
      doc.moveDown();

      data?.forEach((r: any) => {
        doc
          .fontSize(10)
          .text(
            `${r.level.toUpperCase()} (${r.code})` +
              (r.parent_code
                ? `  ←  ${r.parent_level.toUpperCase()} (${r.parent_code})`
                : "")
          );
      });

      doc.end();
    });

    try {
      await writeAuditLog({
        ...auditBase,
        status: "success",
        metadata: { ...auditBase.metadata, rows: (data || []).length },
      });
    } catch {
      // do not fail response because auditing failed
    }

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=trace_${code}.pdf`,
      },
    });
  }

  try {
    await writeAuditLog({
      ...auditBase,
      status: "failed",
      metadata: { ...auditBase.metadata, error: "Invalid format" },
    });
  } catch {
    // do not fail response because auditing failed
  }

  return apiJson(
    { error: "Invalid format" },
    { status: 400 }
  );
}


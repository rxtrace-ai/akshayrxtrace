import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateCanonicalGS1 } from "@/lib/gs1Canonical";
import { resolveCodeMode } from "@/lib/codeMode";
import { buildPicUnitPayload } from "@/lib/picPayload";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { enforceEntitlement, refundEntitlement } from "@/lib/entitlement/enforce";
import { UsageType } from "@/lib/entitlement/usageTypes";
import { getRequestIdFromRequest } from "@/lib/http/requestId";
import { generateUnitSerial } from "@/lib/serial/unitSerial";

// ---------- utils ----------
const MAX_UNITS_PER_REQUEST = 10000;
const DB_INSERT_BATCH_SIZE = 1000;

// ---------- API ----------
export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  try {
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const {
      company_id: requestedCompanyId,
      company_name,
      sku_code,
      sku_name,
      gtin,
      batch,
      mfd,
      expiry,
      mrp,
      quantity,
      compliance_ack
    } = body;
    const company_id = authCompanyId;
    const requestId = typeof body?.request_id === "string" && body.request_id.trim()
      ? `unit_create:body:${body.request_id.trim()}`
      : getRequestIdFromRequest(req, "unit_create");

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!compliance_ack) {
      return NextResponse.json({ error: "compliance_ack=true is required" }, { status: 400 });
    }

    if (!sku_code || !batch || !mfd || !expiry || mrp === undefined || !quantity) {
      return NextResponse.json(
        { error: "Invalid / missing fields" },
        { status: 400 }
      );
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
    }
    if (qty > MAX_UNITS_PER_REQUEST) {
      return NextResponse.json(
        { error: `quantity exceeds limit (${MAX_UNITS_PER_REQUEST})`, code: "limit_exceeded", max: MAX_UNITS_PER_REQUEST },
        { status: 400 }
      );
    }

    const decision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.UNIT_LABEL,
      quantity: qty,
      requestId,
      metadata: { source: "unit_create" },
    });
    if (!decision.allow) {
      return NextResponse.json(
        {
          error: decision.reason_code,
          remaining: decision.remaining,
        },
        { status: 403 }
      );
    }

    const codeMode = resolveCodeMode({ gtin });
    const gtinForStorage = typeof gtin === "string" ? gtin.trim() : "";

    // ---------- SKU UPSERT ----------
    const { data: sku, error: skuErr } = await supabase
      .from("skus")
      .upsert(
        {
          company_id,
          sku_code,
          sku_name,
          gtin: codeMode === "GS1" && gtinForStorage ? gtinForStorage : null,
        },
        { onConflict: "company_id,sku_code" }
      )
      .select("id")
      .single();

    if (skuErr || !sku) throw skuErr;

    // ---------- UNIT GENERATION ----------
    // Generate serials locally (no per-serial DB reads). DB uniqueness constraint is the source of truth.
    const buildRows = () => {
      const rows: any[] = [];
      for (let i = 0; i < qty; i++) {
        const serial = generateUnitSerial(company_id);

        const payload =
          codeMode === "GS1"
            ? generateCanonicalGS1({
                gtin: gtinForStorage,
                expiry,
                mfgDate: mfd,
                batch,
                serial,
                mrp: Number(mrp),
                sku: sku_code,
              })
            : buildPicUnitPayload({
                sku: String(sku_code).trim().toUpperCase(),
                batch: String(batch),
                expiryYYMMDD: (() => {
                  const dt = new Date(String(expiry));
                  const yy = String(dt.getFullYear()).slice(-2);
                  const mm = String(dt.getMonth() + 1).padStart(2, "0");
                  const dd = String(dt.getDate()).padStart(2, "0");
                  return `${yy}${mm}${dd}`;
                })(),
                mfgYYMMDD: (() => {
                  const dt = new Date(String(mfd));
                  const yy = String(dt.getFullYear()).slice(-2);
                  const mm = String(dt.getMonth() + 1).padStart(2, "0");
                  const dd = String(dt.getDate()).padStart(2, "0");
                  return `${yy}${mm}${dd}`;
                })(),
                serial,
                mrp: String(mrp),
              });

        rows.push({
          company_id,
          sku_id: sku.id,
          gtin: codeMode === "GS1" ? gtinForStorage : null,
          batch,
          mfd,
          expiry,
          mrp,
          serial,
          gs1_payload: payload,
          code_mode: codeMode,
          payload,
        });
      }
      return rows;
    };

    const rows = buildRows();

    try {
      for (let i = 0; i < rows.length; i += DB_INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + DB_INSERT_BATCH_SIZE);
        const { error } = await supabase.from("labels_units").insert(batch);
        if (error) throw error;
      }
    } catch (e: any) {
      await refundEntitlement({ companyId: company_id, usageType: UsageType.UNIT_LABEL, quantity: qty });

      const isUniqueViolation =
        e?.code === "23505" || String(e?.message || "").toLowerCase().includes("unique");
      if (isUniqueViolation) {
        return NextResponse.json({ error: "Duplicate serial detected. Please try again." }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({
      success: true,
      generated: rows.length,
      items: rows.map((r) => ({ serial: r.serial, gs1: r.payload ?? r.gs1_payload, payload: r.payload ?? r.gs1_payload })),
    });
  } catch (err: any) {
    if (err?.code === 'PAST_DUE' || err?.code === 'SUBSCRIPTION_INACTIVE') {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    return NextResponse.json(
      { error: err?.message || "Unit generation failed" },
      { status: 500 }
    );
  }
}

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
const MAX_SERIAL_RETRY_ATTEMPTS = 5;
const SKU_NOT_FOUND_ERROR = "SKU not found. Create SKU in SKU Master first.";

type UnitLabelRow = {
  company_id: string;
  sku_id: string;
  gtin: string | null;
  batch: string;
  mfd: string;
  expiry: string;
  mrp: unknown;
  serial: string;
  gs1_payload: string;
  code_mode: "GS1" | "PIC";
  payload: string;
};

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
    let gtinForStorage = typeof gtin === "string" ? gtin.trim() : "";
    const normalizedSkuCode = String(sku_code).trim().toUpperCase();

    if (codeMode === "GS1") {
      const { validateGTIN } = await import("@/lib/gs1/gtin");
      const validation = validateGTIN(gtinForStorage);
      if (!validation.valid || !validation.normalized) {
        return NextResponse.json(
          { error: validation.error || "Invalid GTIN format" },
          { status: 400 }
        );
      }
      gtinForStorage = validation.normalized;
    }

    // ---------- SKU LOOKUP ----------
    const { data: sku, error: skuErr } = await supabase
      .from("skus")
      .select("id")
      .eq("company_id", company_id)
      .eq("sku_code", normalizedSkuCode)
      .is("deleted_at", null)
      .maybeSingle();

    if (skuErr) throw skuErr;
    if (!sku?.id) {
      return NextResponse.json({ error: SKU_NOT_FOUND_ERROR }, { status: 404 });
    }

    const expiryYYMMDD = (() => {
      const dt = new Date(String(expiry));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yy}${mm}${dd}`;
    })();
    const mfgYYMMDD = (() => {
      const dt = new Date(String(mfd));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yy}${mm}${dd}`;
    })();

    const buildPayloadForSerial = (serial: string) =>
      codeMode === "GS1"
        ? generateCanonicalGS1({
            gtin: gtinForStorage,
            expiry,
            batch,
            serial,
          })
        : buildPicUnitPayload({
            sku: normalizedSkuCode,
            batch: String(batch),
            expiryYYMMDD,
            mfgYYMMDD,
            serial,
            mrp: String(mrp),
          });

    const allocateUniqueSerial = (usedSerials: Set<string>) => {
      let serial = "";
      do {
        serial = generateUnitSerial();
      } while (usedSerials.has(serial));
      usedSerials.add(serial);
      return serial;
    };

    const createRow = (serial: string): UnitLabelRow => {
      const payload = buildPayloadForSerial(serial);
      return {
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
      };
    };

    // ---------- UNIT GENERATION ----------
    // Keep serials unique within the request; rely on DB uniqueness for cross-request safety.
    const usedSerials = new Set<string>();
    const rows: UnitLabelRow[] = [];
    for (let i = 0; i < qty; i++) {
      rows.push(createRow(allocateUniqueSerial(usedSerials)));
    }

    const regenerateBatchSerials = (batchRows: UnitLabelRow[]) => {
      for (const row of batchRows) {
        usedSerials.delete(row.serial);
      }
      for (const row of batchRows) {
        const serial = allocateUniqueSerial(usedSerials);
        const payload = buildPayloadForSerial(serial);
        row.serial = serial;
        row.gs1_payload = payload;
        row.payload = payload;
      }
    };

    try {
      for (let i = 0; i < rows.length; i += DB_INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + DB_INSERT_BATCH_SIZE);
        let inserted = false;
        let attempts = 0;

        while (!inserted) {
          const { error } = await supabase.from("labels_units").insert(batch);
          if (!error) {
            inserted = true;
            continue;
          }

          const isUniqueViolation =
            error.code === "23505" || String(error.message || "").toLowerCase().includes("unique");
          if (!isUniqueViolation) {
            throw error;
          }

          attempts += 1;
          if (attempts >= MAX_SERIAL_RETRY_ATTEMPTS) {
            throw error;
          }

          regenerateBatchSerials(batch);
        }
      }
    } catch (e: any) {
      await refundEntitlement({ companyId: company_id, usageType: UsageType.UNIT_LABEL, quantity: qty });

      const isUniqueViolation =
        e?.code === "23505" || String(e?.message || "").toLowerCase().includes("unique");
      if (isUniqueViolation) {
        return NextResponse.json({ error: "Duplicate serial detected after retries. Please try again." }, { status: 409 });
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

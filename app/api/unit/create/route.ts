import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateCanonicalGS1 } from "@/lib/gs1Canonical";
import { resolveCodeMode } from "@/lib/codeMode";
import { buildPicUnitPayload } from "@/lib/picPayload";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { enforceEntitlement, refundEntitlement } from "@/lib/entitlement/enforce";
import { UsageType } from "@/lib/entitlement/usageTypes";
import { getRequestIdFromRequest } from "@/lib/http/requestId";
import { generateUnitSerial } from "@/lib/serial/unitSerial";
import { fail, ok } from "@/lib/api/response";

// ---------- utils ----------
const MAX_UNITS_PER_REQUEST = 10000;
const DB_INSERT_BATCH_SIZE = 1000;
const MAX_SERIAL_RETRY_ATTEMPTS = 5;
const LEGACY_UNIT_FIELDS = [
  "sku_code",
  "sku_name",
  "gtin",
  "batch",
  "mfd",
  "expiry",
  "mrp",
  "company_name",
] as const;

type UnitLabelRow = {
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string;
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

type UnitMasterSnapshot = {
  sku_code: string;
  gtin: string | null;
  batch: string;
  mfd: string | null;
  expiry: string;
  mrp: string | null;
};

// ---------- API ----------
export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  try {
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return fail("UNAUTHORIZED", "Unauthorized", 401);
    }

    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const {
      unit_sku_master_id,
      company_id: requestedCompanyId,
      quantity,
      compliance_ack
    } = body;
    const company_id = authCompanyId;
    const requestId = typeof body?.request_id === "string" && body.request_id.trim()
      ? `unit_create:body:${body.request_id.trim()}`
      : getRequestIdFromRequest(req, "unit_create");

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const legacyFieldsProvided = LEGACY_UNIT_FIELDS.filter((field) => body?.[field] !== undefined);
    if (legacyFieldsProvided.length > 0) {
      console.warn("[unit_create] legacy_request_shape_rejected", {
        company_id,
        request_id: requestId,
        fields: legacyFieldsProvided,
      });
      return fail(
        "VALIDATION_ERROR",
        "Unit generation now requires a valid SKU Master selection. Direct fixed-field Unit generation is no longer supported.",
        400
      );
    }

    if (typeof unit_sku_master_id !== "string" || unit_sku_master_id.trim().length === 0) {
      console.warn("[unit_create] missing_unit_sku_master_id", {
        company_id,
        request_id: requestId,
      });
      return fail(
        "VALIDATION_ERROR",
        "unit_sku_master_id is required. Select a valid SKU Master record and try again.",
        400
      );
    }

    if (!compliance_ack) {
      return fail("VALIDATION_ERROR", "compliance_ack=true is required", 400);
    }

    if (!quantity) {
      return fail("VALIDATION_ERROR", "Invalid / missing fields", 400);
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return fail("VALIDATION_ERROR", "quantity must be a positive integer", 400);
    }
    if (qty > MAX_UNITS_PER_REQUEST) {
      return fail("VALIDATION_ERROR", `quantity exceeds limit (${MAX_UNITS_PER_REQUEST})`, 400);
    }

    const { data: unitMaster, error: unitMasterError } = await supabase
      .from("unit_sku_master")
      .select("id, sku_code, gtin, batch, mfd, expiry, mrp")
      .eq("id", unit_sku_master_id.trim())
      .eq("company_id", company_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (unitMasterError) {
      console.error("[unit_create] unit_sku_master_lookup_failed", {
        company_id,
        request_id: requestId,
        unit_sku_master_id,
        error: unitMasterError.message,
      });
      return fail("VALIDATION_ERROR", unitMasterError.message, 400);
    }

    if (!unitMaster) {
      console.warn("[unit_create] unit_sku_master_not_found_or_deleted", {
        company_id,
        request_id: requestId,
        unit_sku_master_id,
      });
      return fail("NOT_FOUND", "Selected SKU Master record not found or is inactive. Refresh the page and try again.", 404);
    }

    const masterSnapshot: UnitMasterSnapshot = {
      sku_code: String(unitMaster.sku_code ?? "").trim(),
      gtin: typeof unitMaster.gtin === "string" ? unitMaster.gtin.trim() : null,
      batch: String(unitMaster.batch ?? "").trim(),
      mfd: typeof unitMaster.mfd === "string" ? unitMaster.mfd : null,
      expiry: String(unitMaster.expiry ?? "").trim(),
      mrp: unitMaster.mrp == null ? null : String(unitMaster.mrp),
    };

    const resolvedSkuCode = masterSnapshot.sku_code;
    const resolvedBatch = masterSnapshot.batch;
    const resolvedExpiry = masterSnapshot.expiry;
    const resolvedMfd = String(masterSnapshot.mfd ?? "").trim() || resolvedExpiry;
    const resolvedMrp = masterSnapshot.mrp;
    const resolvedGtinRaw = typeof masterSnapshot.gtin === "string" ? masterSnapshot.gtin : "";

    if (!resolvedSkuCode || !resolvedBatch || !resolvedExpiry) {
      console.error("[unit_create] invalid_unit_sku_master_snapshot", {
        company_id,
        request_id: requestId,
        unit_sku_master_id,
      });
      return fail("VALIDATION_ERROR", "Selected SKU Master record is incomplete. Create a new valid SKU Master record and try again.", 400);
    }

    const codeMode = resolveCodeMode({ gtin: resolvedGtinRaw || null });
    let gtinForStorage = resolvedGtinRaw;
    const normalizedSkuCode = String(resolvedSkuCode).trim().toUpperCase();

    if (codeMode === "GS1") {
      const { validateGTIN } = await import("@/lib/gs1/gtin");
      const validation = validateGTIN(gtinForStorage);
      if (!validation.valid || !validation.normalized) {
        console.warn("[unit_create] invalid_gtin_on_unit_sku_master", {
          company_id,
          request_id: requestId,
          unit_sku_master_id,
        });
        return fail("VALIDATION_ERROR", validation.error || "Invalid GTIN format", 400);
      }
      gtinForStorage = validation.normalized;
    }

    // ---------- LEGACY SKU REFERENCE LOOKUP ----------
    const { data: sku, error: skuErr } = await supabase
      .from("skus")
      .select("id")
      .eq("company_id", company_id)
      .eq("sku_code", normalizedSkuCode)
      .is("deleted_at", null)
      .maybeSingle();

    if (skuErr) throw skuErr;
    const legacySkuId = sku?.id ?? null;
    if (!legacySkuId) {
      console.info("[unit_create] legacy_sku_reference_missing", {
        company_id,
        request_id: requestId,
        unit_sku_master_id,
      });
    }

    const expiryYYMMDD = (() => {
      const dt = new Date(String(resolvedExpiry));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yy}${mm}${dd}`;
    })();
    const mfgYYMMDD = (() => {
      const dt = new Date(String(resolvedMfd));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yy}${mm}${dd}`;
    })();

    const buildPayloadForSerial = (serial: string) =>
      codeMode === "GS1"
        ? generateCanonicalGS1({
            gtin: gtinForStorage,
            expiry: resolvedExpiry,
            batch: resolvedBatch,
            serial,
          })
        : buildPicUnitPayload({
            sku: normalizedSkuCode,
            batch: String(resolvedBatch),
            expiryYYMMDD,
            mfgYYMMDD,
            serial,
            mrp: resolvedMrp || undefined,
          });

    const decision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.UNIT_LABEL,
      quantity: qty,
      requestId,
      metadata: {
        source: "unit_create",
        unit_sku_master_id: unit_sku_master_id.trim(),
        code_mode: codeMode,
      },
    });
    if (!decision.allow) {
      const isQuotaError = String(decision.reason_code || "").toUpperCase().includes("QUOTA_EXCEEDED");
      return fail(
        String(decision.reason_code || "QUOTA_EXCEEDED"),
        isQuotaError ? "Quota exceeded. Please purchase add-ons." : String(decision.reason_code || "QUOTA_EXCEEDED"),
        403
      );
    }

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
        sku_id: legacySkuId,
        unit_sku_master_id: unit_sku_master_id.trim(),
        gtin: codeMode === "GS1" ? gtinForStorage : null,
        batch: resolvedBatch,
        mfd: resolvedMfd,
        expiry: resolvedExpiry,
        mrp: resolvedMrp,
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
        return fail("CONFLICT", "Duplicate serial detected after retries. Please try again.", 409);
      }
      throw e;
    }

    return ok({
      generated: rows.length,
      items: rows.map((r) => ({
        serial: r.serial,
        gs1: r.payload ?? r.gs1_payload,
        payload: r.payload ?? r.gs1_payload,
        code_mode: r.code_mode,
      })),
    });
  } catch (err: any) {
    if (err?.code === 'PAST_DUE' || err?.code === 'SUBSCRIPTION_INACTIVE') {
      return fail(String(err.code), err.message, 402);
    }
    return fail("INTERNAL_ERROR", err?.message || "Unit generation failed", 500);
  }
}

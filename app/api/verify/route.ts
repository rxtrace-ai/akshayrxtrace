import crypto from "crypto";
import { NextResponse } from "next/server";
import { parsePayload } from "@/lib/parsePayload";
import { compareGS1Payloads } from "@/lib/gs1Canonical";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { isExpiredStrict } from "@/lib/scanner/expiry";
import { beginScannerIdempotency, completeScannerIdempotency, waitForScannerReplay } from "@/lib/scanner/idempotency";
import { insertScanLogSafe, recordSerialScanAtomic } from "@/lib/scanner/logging";
import { extractVerifyRawInput, verifyRequestBodySchema } from "@/lib/scanner/schemas";
import { logError } from "@/lib/observability/logging";

const GS = String.fromCharCode(29);

function okPayload(data: any) {
  return { success: true, ...data };
}

function failPayload(code: string, message: string) {
  return { success: false, error: { code, message } };
}

function json(statusCode: number, payload: any) {
  return NextResponse.json(payload, { status: statusCode });
}

function requireApiKeyIfConfigured(req: Request) {
  const required = process.env.VERIFY_API_KEY;
  if (!required) return;
  const provided = req.headers.get("x-api-key") || "";
  if (provided !== required) {
    throw new Error("UNAUTHORIZED");
  }
}

function normalizeMachinePayload(input: string): string {
  return String(input || "")
    .replace(/[()]/g, "")
    .replace(/[\u001D\u00F1]/g, GS)
    .replace(/\s/g, "");
}

type UnitCandidate = {
  id: string;
  company_id: string;
  serial: string;
  gtin: string | null;
  batch: string | null;
  payload: string | null;
  gs1_payload: string | null;
  code_mode: "GS1" | "PIC" | null;
  created_at: string;
};

function pickUnitCandidate(params: {
  rawInput: string;
  mode: "GS1" | "PIC";
  serial: string;
  gtin?: string;
  batch?: string;
  candidates: UnitCandidate[];
}): UnitCandidate | null {
  const { rawInput, mode, serial, gtin, batch, candidates } = params;

  const matching = candidates.filter((candidate) => {
    if (String(candidate.serial || "").trim() !== serial) return false;
    if (mode === "GS1") {
      if (gtin && candidate.gtin && String(candidate.gtin) !== gtin) return false;
      if (batch && candidate.batch && String(candidate.batch) !== batch) return false;
      const storedPayload = candidate.payload || candidate.gs1_payload;
      if (storedPayload && !compareGS1Payloads(storedPayload, rawInput)) return false;
      return true;
    }

    const storedPayload = candidate.payload || candidate.gs1_payload;
    if (storedPayload) {
      return normalizeMachinePayload(storedPayload) === normalizeMachinePayload(rawInput);
    }
    return true;
  });

  if (matching.length === 0) return null;

  const companyIds = new Set(matching.map((row) => row.company_id));
  if (companyIds.size > 1) {
    return null;
  }

  return matching.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] ?? null;
}

export async function POST(req: Request) {
  try {
    requireApiKeyIfConfigured(req);

    const supabase = getSupabaseAdmin();
    const authCompanyId = await resolveCompanyIdFromRequest(req).catch(() => null);

    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return json(400, failPayload("INVALID_REQUEST", "Request body must be a JSON object"));
    }

    const parsedBody = verifyRequestBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return json(400, failPayload("INVALID_REQUEST", "Invalid verify request payload"));
    }

    const body = parsedBody.data;
    if (body.company_id && authCompanyId && body.company_id !== authCompanyId) {
      return json(403, failPayload("FORBIDDEN", "Forbidden"));
    }

    const rawInput = extractVerifyRawInput(body);
    const parsedAny = parsePayload(rawInput);

    const mode = parsedAny.mode === "INVALID" ? "INVALID" : parsedAny.mode;
    const serial =
      parsedAny.mode === "GS1"
        ? String(parsedAny.parsed.serialNo || "").trim()
        : parsedAny.mode === "PIC"
          ? String(parsedAny.parsed.serial || "").trim()
          : "";
    const gtin = parsedAny.mode === "GS1" ? String(parsedAny.parsed.gtin || "").trim() : "";
    const batch =
      parsedAny.mode === "GS1"
        ? String(parsedAny.parsed.batchNo || "").trim()
        : parsedAny.mode === "PIC"
          ? String(parsedAny.parsed.batch || "").trim()
          : "";
    const expiryRaw =
      parsedAny.mode === "GS1"
        ? String(parsedAny.parsed.expiryDate || "").trim()
        : parsedAny.mode === "PIC"
          ? String(parsedAny.parsed.expiryYYMMDD || "").trim()
          : "";

    let resolvedCompanyId: string | null = authCompanyId;
    let matchedUnit: UnitCandidate | null = null;

    if (parsedAny.mode !== "INVALID" && serial) {
      let unitQuery = supabase
        .from("labels_units")
        .select("id, company_id, serial, gtin, batch, payload, gs1_payload, code_mode, created_at")
        .eq("serial", serial)
        .order("created_at", { ascending: true })
        .limit(authCompanyId ? 10 : 30);

      if (authCompanyId) {
        unitQuery = unitQuery.eq("company_id", authCompanyId);
      }

      const { data: units, error: unitError } = await unitQuery;
      if (unitError) throw unitError;

      matchedUnit = pickUnitCandidate({
        rawInput,
        mode: parsedAny.mode,
        serial,
        gtin: gtin || undefined,
        batch: batch || undefined,
        candidates: ((units as any[]) || []) as UnitCandidate[],
      });

      if (matchedUnit?.company_id) {
        resolvedCompanyId = matchedUnit.company_id;
      }
    }

    const scopeKey = resolvedCompanyId ? `company:${resolvedCompanyId}` : `public:${crypto.createHash("sha256").update(rawInput).digest("hex").slice(0, 12)}`;
    const idem = await beginScannerIdempotency({
      supabase,
      endpoint: "/api/verify",
      scopeKey,
      req,
      body,
      requestHashPayload: {
        raw: rawInput,
        mode,
        serial: serial || null,
        company_scope: scopeKey,
      },
    });

    if (idem.kind === "missing_key") {
      return json(400, failPayload("INVALID_REQUEST", "Missing Idempotency-Key header"));
    }
    if (idem.kind === "conflict") {
      return json(409, failPayload("INVALID_REQUEST", "Idempotency key conflict"));
    }
    if (idem.kind === "replay") {
      return json(idem.statusCode, idem.payload);
    }
    if (idem.kind === "pending") {
      const wait = await waitForScannerReplay({
        supabase,
        endpoint: "/api/verify",
        scopeKey,
        idempotencyKey: idem.key,
        requestHash: idem.requestHash,
        timeoutMs: 3500,
      });
      if (wait.kind === "replay") {
        return json(wait.statusCode, wait.payload);
      }
      return json(409, failPayload("INVALID_REQUEST", "Request already in progress"));
    }

    const finalize = async (statusCode: number, payload: any) => {
      try {
        await completeScannerIdempotency({
          supabase,
          endpoint: "/api/verify",
          scopeKey,
          idempotencyKey: idem.key,
          requestHash: idem.requestHash,
          statusCode,
          payload,
        });
      } catch (error: any) {
        logError("Failed to finalize verify idempotency", {
          route: "/api/verify",
          companyId: resolvedCompanyId ?? undefined,
          error: String(error?.message || error),
        });
      }
      return json(statusCode, payload);
    };

    const parsedForLog =
      parsedAny.mode === "INVALID"
        ? { parseError: parsedAny.error, raw: parsedAny.raw }
        : {
            mode: parsedAny.mode,
            serial: serial || null,
            gtin: gtin || null,
            batch: batch || null,
          };

    if (parsedAny.mode === "INVALID") {
      const payload = okPayload({
        status: "INVALID",
        code: "INVALID_CODE",
        message: parsedAny.error || "Invalid payload",
        mode: "INVALID",
      });
      await insertScanLogSafe(supabase, {
        company_id: resolvedCompanyId,
        raw_scan: rawInput,
        parsed: parsedForLog,
        scanner_printer_id: req.headers.get("x-printer-id") || null,
        ip: req.headers.get("x-forwarded-for") || null,
        metadata: { status: "INVALID", reason: "parse_error", quota_consumed: false },
        status: "FAILED",
        endpoint: "verify",
        idempotency_key: idem.key,
        request_hash: idem.requestHash,
      });
      return finalize(200, payload);
    }

    if (!serial || (parsedAny.mode === "GS1" && !gtin)) {
      const payload = okPayload({
        status: "INVALID",
        code: "INVALID_CODE",
        message: parsedAny.mode === "GS1" ? "Missing serial or GTIN" : "Missing serial",
        mode: parsedAny.mode,
      });
      await insertScanLogSafe(supabase, {
        company_id: resolvedCompanyId,
        raw_scan: rawInput,
        parsed: parsedForLog,
        scanner_printer_id: req.headers.get("x-printer-id") || null,
        ip: req.headers.get("x-forwarded-for") || null,
        metadata: { status: "INVALID", reason: "missing_required_fields", mode: parsedAny.mode, quota_consumed: false },
        status: "FAILED",
        endpoint: "verify",
        idempotency_key: idem.key,
        request_hash: idem.requestHash,
      });
      return finalize(200, payload);
    }

    if (!matchedUnit?.id || !resolvedCompanyId) {
      const payload = okPayload({
        status: "INVALID",
        code: "INVALID_CODE",
        message: "Code not found",
        mode: parsedAny.mode,
      });
      await insertScanLogSafe(supabase, {
        company_id: resolvedCompanyId,
        raw_scan: rawInput,
        parsed: parsedForLog,
        scanner_printer_id: req.headers.get("x-printer-id") || null,
        ip: req.headers.get("x-forwarded-for") || null,
        metadata: { status: "INVALID", reason: "code_not_found", mode: parsedAny.mode, quota_consumed: false },
        status: "FAILED",
        endpoint: "verify",
        idempotency_key: idem.key,
        request_hash: idem.requestHash,
      });
      return finalize(200, payload);
    }

    const expiry = expiryRaw ? isExpiredStrict(expiryRaw) : { valid: true, expired: false, isoDate: undefined };
    if (expiryRaw && !expiry.valid) {
      const payload = okPayload({
        status: "INVALID",
        code: "INVALID_CODE",
        message: "Invalid expiry format",
        mode: parsedAny.mode,
      });
      await insertScanLogSafe(supabase, {
        company_id: resolvedCompanyId,
        raw_scan: rawInput,
        parsed: parsedForLog,
        code_id: matchedUnit.id,
        scanner_printer_id: req.headers.get("x-printer-id") || null,
        ip: req.headers.get("x-forwarded-for") || null,
        metadata: { status: "INVALID", reason: "invalid_expiry", mode: parsedAny.mode, quota_consumed: false },
        status: "FAILED",
        endpoint: "verify",
        idempotency_key: idem.key,
        request_hash: idem.requestHash,
      });
      return finalize(200, payload);
    }

    const duplicate = await recordSerialScanAtomic({
      supabase,
      companyId: resolvedCompanyId,
      serial,
    });

    let status: "VALID" | "DUPLICATE" | "EXPIRED" = "VALID";
    if (expiry.expired) {
      status = "EXPIRED";
    } else if (duplicate.isDuplicate) {
      status = "DUPLICATE";
    }

    const payload = okPayload({
      status,
      code: status === "DUPLICATE" ? "ALREADY_VERIFIED" : status === "EXPIRED" ? "INVALID_CODE" : "VALID",
      message:
        status === "VALID"
          ? "Authentic product"
          : status === "DUPLICATE"
            ? "Code already verified"
            : "Product has expired",
      mode: parsedAny.mode,
      firstScanAt: duplicate.firstScannedAt,
      product: {
        gtin: gtin || undefined,
        serial,
        batch: batch || undefined,
        expiry: expiry.isoDate,
      },
      parsed:
        parsedAny.mode === "GS1"
          ? {
              ...parsedAny.parsed,
              expiryDate: expiry.isoDate || parsedAny.parsed.expiryDate,
            }
          : parsedAny.parsed,
    });

    await insertScanLogSafe(supabase, {
      company_id: resolvedCompanyId,
      raw_scan: rawInput,
      parsed: parsedForLog,
      code_id: matchedUnit.id,
      scanner_printer_id: req.headers.get("x-printer-id") || null,
      ip: req.headers.get("x-forwarded-for") || null,
      metadata: {
        status,
        mode: parsedAny.mode,
        serial,
        gtin: gtin || null,
        batch: batch || null,
        expiry: expiry.isoDate || null,
        first_scanned_at: duplicate.firstScannedAt,
        scan_count: duplicate.scanCount,
        quota_consumed: false,
      },
      status: status === "VALID" ? "SUCCESS" : "FAILED",
      endpoint: "verify",
      idempotency_key: idem.key,
      request_hash: idem.requestHash,
    });

    return finalize(200, payload);
  } catch (err: any) {
    const message = String(err?.message || "").toUpperCase();
    if (message === "UNAUTHORIZED") {
      return json(401, failPayload("UNAUTHORIZED", "Unauthorized"));
    }

    logError("verify route failure", {
      route: "/api/verify",
      error: String(err?.message || err),
    });
    return json(500, failPayload("INTERNAL_ERROR", "Unable to process verification"));
  }
}

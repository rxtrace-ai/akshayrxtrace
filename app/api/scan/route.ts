import { NextResponse } from "next/server";
import { z } from "zod";
import { parsePayload } from "@/lib/parsePayload";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { compareGS1Payloads, normalizeGS1Payload } from "@/lib/gs1Canonical";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { isExpiredStrict } from "@/lib/scanner/expiry";
import { beginScannerIdempotency, completeScannerIdempotency, waitForScannerReplay } from "@/lib/scanner/idempotency";
import { insertScanLogSafe, recordSerialScanAtomic } from "@/lib/scanner/logging";
import { scanRequestBodySchema } from "@/lib/scanner/schemas";
import { logError } from "@/lib/observability/logging";
import { enforceScanRateLimit } from "@/lib/scanner/requestRateLimit";

const GS = String.fromCharCode(29);

function okPayload(data: any) {
  return { success: true, data };
}

function failPayload(code: string, message: string) {
  return { success: false, error: { code, message } };
}

function json(statusCode: number, payload: any) {
  return NextResponse.json(payload, { status: statusCode });
}

function normalizeMachinePayload(input: string): string {
  return String(input || "")
    .replace(/[()]/g, "")
    .replace(/[\u001D\u00F1]/g, GS)
    .replace(/\s/g, "");
}

async function buildHierarchyForPallet(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  palletId: string;
  companyId: string;
}) {
  const { supabase, palletId, companyId } = opts;

  const { data: pallet } = await supabase
    .from("pallets")
    .select("id, sscc, sscc_with_ai, sku_id, created_at, meta")
    .eq("id", palletId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!pallet?.id) return null;

  const { data: cartons } = await supabase
    .from("cartons")
    .select("id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
    .eq("company_id", companyId)
    .eq("pallet_id", palletId)
    .order("created_at", { ascending: true });

  const cartonIds = (cartons ?? []).map((c: any) => c.id).filter(Boolean);
  const { data: boxes } = cartonIds.length
    ? await supabase
        .from("boxes")
        .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
        .eq("company_id", companyId)
        .in("carton_id", cartonIds)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };

  const boxIds = (boxes ?? []).map((b: any) => b.id).filter(Boolean);
  const { data: units } = boxIds.length
    ? await supabase
        .from("labels_units")
        .select("id, box_id, serial, created_at")
        .eq("company_id", companyId)
        .in("box_id", boxIds)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };

  const unitsByBox = new Map<string, any[]>();
  for (const u of units ?? []) {
    const key = (u as any).box_id;
    if (!key) continue;
    const list = unitsByBox.get(key) ?? [];
    list.push({ uid: (u as any).serial, id: (u as any).id, created_at: (u as any).created_at });
    unitsByBox.set(key, list);
  }

  const boxesByCarton = new Map<string, any[]>();
  for (const b of boxes ?? []) {
    const key = (b as any).carton_id;
    if (!key) continue;
    const list = boxesByCarton.get(key) ?? [];
    list.push({ ...(b as any), units: unitsByBox.get((b as any).id) ?? [] });
    boxesByCarton.set(key, list);
  }

  const cartonsWithChildren = (cartons ?? []).map((c: any) => ({
    ...(c as any),
    boxes: boxesByCarton.get((c as any).id) ?? [],
  }));

  return { ...(pallet as any), cartons: cartonsWithChildren };
}

async function findRowBySsccOrCode(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: "cartons" | "boxes",
  select: string,
  companyId: string | null,
  code: string
) {
  let base = supabase.from(table).select(select);
  if (companyId) {
    base = base.eq("company_id", companyId);
  }

  const { data: bySscc } = await base.eq("sscc", code).maybeSingle();
  if (bySscc) return bySscc;

  let codeBase = supabase.from(table).select(select);
  if (companyId) {
    codeBase = codeBase.eq("company_id", companyId);
  }

  const { data: byCode } = await codeBase.eq("code", code).maybeSingle();
  return byCode ?? null;
}

async function findCompanyBySscc(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sscc: string
) {
  const { data: palletRow } = await supabase
    .from("pallets")
    .select("company_id")
    .eq("sscc", sscc)
    .maybeSingle();
  if (palletRow?.company_id) return palletRow.company_id;

  const [cartonRow, boxRow] = await Promise.all([
    findRowBySsccOrCode(supabase, "cartons", "company_id", null, sscc),
    findRowBySsccOrCode(supabase, "boxes", "company_id", null, sscc),
  ]);

  return (cartonRow as any)?.company_id ?? (boxRow as any)?.company_id ?? null;
}

const scanRequestSchema = scanRequestBodySchema.extend({
  raw: z.string().trim().min(1).max(4096),
});

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();

  const authCompanyId = await resolveCompanyIdFromRequest(req);
  if (!authCompanyId) {
    return json(401, failPayload("UNAUTHORIZED", "Unauthorized"));
  }

  const rawBody = await req.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return json(400, failPayload("INVALID_REQUEST", "Request body must be a JSON object"));
  }

  const parsedBody = scanRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return json(400, failPayload("INVALID_REQUEST", "Invalid scan request payload"));
  }

  const body = parsedBody.data;
  if (body.company_id && body.company_id !== authCompanyId) {
    return json(403, failPayload("FORBIDDEN", "Forbidden"));
  }

  const rateLimit = await enforceScanRateLimit({
    req,
    companyId: authCompanyId,
    rawInput: body.raw,
    deviceContext: body.device_context,
  });
  if (!rateLimit.allowed) {
    const response = json(429, failPayload("RATE_LIMITED", "Too many scan requests. Please try again shortly."));
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const scopeKey = `company:${authCompanyId}`;
  const idem = await beginScannerIdempotency({
    supabase,
    endpoint: "/api/scan",
    scopeKey,
    req,
    body,
    requestHashPayload: {
      raw: body.raw,
      company_id: body.company_id ?? null,
      device_context: body.device_context ?? null,
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
      endpoint: "/api/scan",
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
        endpoint: "/api/scan",
        scopeKey,
        idempotencyKey: idem.key,
        requestHash: idem.requestHash,
        statusCode,
        payload,
      });
    } catch (error: any) {
      logError("Failed to finalize scan idempotency", {
        route: "/api/scan",
        companyId: authCompanyId,
        error: String(error?.message || error),
      });
    }
    return json(statusCode, payload);
  };

  try {
    const parsedAny = parsePayload(body.raw);
    if (parsedAny.mode === "INVALID") {
      const payload = failPayload("INVALID_CODE", parsedAny.error || "Invalid payload");
      return finalize(400, payload);
    }

    const data =
      parsedAny.mode === "GS1"
        ? (parsedAny.parsed as any)
        : ({
            raw: body.raw,
            parsed: true,
            serialNo: parsedAny.parsed.serial,
            sscc: undefined,
            expiryDate: undefined,
          } as any);

    let resolvedCompanyId = authCompanyId;

    if (!resolvedCompanyId && data.serialNo) {
      const { data: unit } = await supabase
        .from("labels_units")
        .select("company_id")
        .eq("serial", data.serialNo)
        .maybeSingle();

      if (unit?.company_id) {
        resolvedCompanyId = unit.company_id;
      }
    }

    if (!resolvedCompanyId && data.sscc) {
      resolvedCompanyId = await findCompanyBySscc(supabase, data.sscc);
    }

    if (!resolvedCompanyId) {
      return finalize(400, failPayload("INVALID_REQUEST", "Cannot resolve company from scanned payload"));
    }

    let expiryStatus: "VALID" | "EXPIRED" = "VALID";
    let logStatus: "SUCCESS" | "ERROR" = "SUCCESS";
    let errorReason: string | null = null;

    if (data.expiryDate) {
      const expiry = isExpiredStrict(data.expiryDate);
      if (!expiry.valid) {
        return finalize(400, failPayload("INVALID_CODE", "Invalid expiry in scanned code"));
      }
      data.expiryDate = expiry.isoDate;
      if (expiry.expired) {
        expiryStatus = "EXPIRED";
        logStatus = "ERROR";
        errorReason = "PRODUCT_EXPIRED";
      }
    }

    let level: "unit" | "box" | "carton" | "pallet" | null = null;
    let result: any = null;

    if (data.sscc) {
      const { data: palletRow } = await supabase
        .from("pallets")
        .select("id")
        .eq("company_id", resolvedCompanyId)
        .eq("sscc", data.sscc)
        .maybeSingle();

      if (palletRow?.id) {
        result = await buildHierarchyForPallet({ supabase, palletId: palletRow.id, companyId: resolvedCompanyId });
        level = "pallet";
      }

      if (!result) {
        const { data: carton } = await supabase
          .from("cartons")
          .select("id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
          .eq("company_id", resolvedCompanyId)
          .eq("sscc", data.sscc)
          .maybeSingle();
        const cartonResolved = carton?.id
          ? carton
          : await findRowBySsccOrCode(
              supabase,
              "cartons",
              "id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta",
              resolvedCompanyId,
              data.sscc
            );

        if ((cartonResolved as any)?.id) {
          const { data: boxes } = await supabase
            .from("boxes")
            .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
            .eq("company_id", resolvedCompanyId)
            .eq("carton_id", (cartonResolved as any).id)
            .order("created_at", { ascending: true });

          const boxIds = (boxes ?? []).map((b: any) => b.id).filter(Boolean);
          const { data: units } = boxIds.length
            ? await supabase
                .from("labels_units")
                .select("id, box_id, serial, created_at")
                .eq("company_id", resolvedCompanyId)
                .in("box_id", boxIds)
                .order("created_at", { ascending: true })
            : { data: [] as any[] };

          const unitsByBox = new Map<string, any[]>();
          for (const u of units ?? []) {
            const key = (u as any).box_id;
            if (!key) continue;
            const list = unitsByBox.get(key) ?? [];
            list.push({ uid: (u as any).serial, id: (u as any).id, created_at: (u as any).created_at });
            unitsByBox.set(key, list);
          }

          const boxesWithUnits = (boxes ?? []).map((b: any) => ({
            ...(b as any),
            units: unitsByBox.get((b as any).id) ?? [],
          }));

          const palletNode = (cartonResolved as any).pallet_id
            ? await buildHierarchyForPallet({ supabase, palletId: (cartonResolved as any).pallet_id, companyId: resolvedCompanyId })
            : null;

          result = {
            ...(cartonResolved as any),
            boxes: boxesWithUnits,
            pallet: palletNode ? { id: palletNode.id, sscc: palletNode.sscc, sscc_with_ai: palletNode.sscc_with_ai } : null,
          };
          level = "carton";
        }
      }

      if (!result) {
        const { data: box } = await supabase
          .from("boxes")
          .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
          .eq("company_id", resolvedCompanyId)
          .eq("sscc", data.sscc)
          .maybeSingle();
        const boxResolved = box?.id
          ? box
          : await findRowBySsccOrCode(
              supabase,
              "boxes",
              "id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta",
              resolvedCompanyId,
              data.sscc
            );

        if ((boxResolved as any)?.id) {
          const { data: units } = await supabase
            .from("labels_units")
            .select("id, box_id, serial, created_at")
            .eq("company_id", resolvedCompanyId)
            .eq("box_id", (boxResolved as any).id)
            .order("created_at", { ascending: true });

          const { data: cartonNode } = (boxResolved as any).carton_id
            ? await supabase
                .from("cartons")
                .select("id, pallet_id, sscc, sscc_with_ai, code, created_at")
                .eq("id", (boxResolved as any).carton_id)
                .maybeSingle()
            : { data: null as any };

          const palletId = (cartonNode as any)?.pallet_id ?? (boxResolved as any).pallet_id ?? null;
          const palletNode = palletId
            ? await supabase
                .from("pallets")
                .select("id, sscc, sscc_with_ai, created_at")
                .eq("id", palletId)
                .maybeSingle()
            : { data: null as any };

          result = {
            ...(boxResolved as any),
            units: (units ?? []).map((u: any) => ({ uid: u.serial, id: u.id, created_at: u.created_at })),
            carton: cartonNode ?? null,
            pallet: (palletNode as any)?.data ?? null,
          };
          level = "box";
        }
      }
    }

    if (!result && data.serialNo) {
      const { data: unit } = await supabase
        .from("labels_units")
        .select("id, box_id, serial, gs1_payload, payload, code_mode, created_at, company_id")
        .eq("company_id", resolvedCompanyId)
        .eq("serial", data.serialNo)
        .maybeSingle();

      if (unit?.id) {
        const { data: boxNode } = unit.box_id
          ? await supabase
              .from("boxes")
              .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, created_at")
              .eq("id", unit.box_id)
              .maybeSingle()
          : { data: null as any };

        const { data: cartonNode } = (boxNode as any)?.carton_id
          ? await supabase
              .from("cartons")
              .select("id, pallet_id, sscc, sscc_with_ai, code, created_at")
              .eq("id", (boxNode as any).carton_id)
              .maybeSingle()
          : { data: null as any };

        const palletId = (cartonNode as any)?.pallet_id ?? (boxNode as any)?.pallet_id ?? null;
        const { data: palletNode } = palletId
          ? await supabase
              .from("pallets")
              .select("id, sscc, sscc_with_ai, created_at")
              .eq("id", palletId)
              .maybeSingle()
          : { data: null as any };

        const storedPayload = (unit as any).payload ?? unit.gs1_payload;
        const codeMode = ((unit as any).code_mode ?? "GS1") as "GS1" | "PIC";
        if (storedPayload) {
          const payloadsMatch =
            codeMode === "GS1"
              ? compareGS1Payloads(storedPayload, body.raw)
              : normalizeMachinePayload(storedPayload) === normalizeMachinePayload(body.raw);
          if (!payloadsMatch) {
            await insertScanLogSafe(supabase, {
              company_id: unit.company_id || resolvedCompanyId,
              raw_scan: body.raw,
              parsed: { serialNo: data.serialNo || null },
              status: "FAILED",
              endpoint: "scan",
              idempotency_key: idem.key,
              request_hash: idem.requestHash,
              metadata: {
                level: "unit",
                status: "PAYLOAD_MISMATCH",
                stored_payload: codeMode === "GS1" ? normalizeGS1Payload(storedPayload) : normalizeMachinePayload(storedPayload),
                scanned_payload: codeMode === "GS1" ? normalizeGS1Payload(body.raw) : normalizeMachinePayload(body.raw),
                unit_id: unit.id,
              },
            });
            return finalize(400, failPayload("INVALID_CODE", "Payload mismatch - code may be tampered"));
          }
        }

        if (unit.company_id && unit.company_id !== resolvedCompanyId) {
          resolvedCompanyId = unit.company_id;
        }

        result = {
          uid: unit.serial,
          id: unit.id,
          created_at: unit.created_at,
          gs1_payload: unit.gs1_payload,
          payload: (unit as any).payload ?? unit.gs1_payload,
          code_mode: (unit as any).code_mode ?? null,
          box: boxNode ?? null,
          carton: cartonNode ?? null,
          pallet: palletNode ?? null,
        };
        level = "unit";
      }
    }

    if (!result || !level) {
      return finalize(404, failPayload("INVALID_CODE", "Code not found in hierarchy"));
    }

    const serial = String(data.serialNo || "").trim();
    let duplicateInfo: { isDuplicate: boolean; firstScannedAt: string | null; scanCount: number } | null = null;
    if (serial) {
      duplicateInfo = await recordSerialScanAtomic({
        supabase,
        companyId: resolvedCompanyId,
        serial,
      });
    }

    const status = expiryStatus === "EXPIRED" ? "EXPIRED" : duplicateInfo?.isDuplicate ? "DUPLICATE" : "VALID";

    await insertScanLogSafe(supabase, {
      company_id: resolvedCompanyId,
      raw_scan: body.raw,
      parsed: {
        mode: parsedAny.mode,
        serialNo: serial || null,
        sscc: data.sscc || null,
        expiryDate: data.expiryDate || null,
      },
      code_id: result?.id || null,
      status: logStatus,
      endpoint: "scan",
      idempotency_key: idem.key,
      request_hash: idem.requestHash,
      metadata: {
        level,
        serial: serial || null,
        expiry_status: expiryStatus,
        status,
        first_scanned_at: duplicateInfo?.firstScannedAt ?? null,
        scan_count: duplicateInfo?.scanCount ?? null,
        error_reason: errorReason,
        device_context: body.device_context || null,
        quota_consumed: false,
      },
    });

    const payload = okPayload({
      status,
      level,
      duplicate: Boolean(duplicateInfo?.isDuplicate),
      firstScanAt: duplicateInfo?.firstScannedAt ?? null,
      result,
    });

    return finalize(200, payload);
  } catch (err: any) {
    logError("scan route failure", {
      route: "/api/scan",
      companyId: authCompanyId,
      error: String(err?.message || err),
    });
    return finalize(500, failPayload("INTERNAL_ERROR", "Unable to process scan"));
  }
}

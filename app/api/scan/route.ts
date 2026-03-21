import { parsePayload } from "@/lib/parsePayload";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { compareGS1Payloads, normalizeGS1Payload } from "@/lib/gs1Canonical";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";
import { fail, ok } from "@/lib/api/response";

const GS = String.fromCharCode(29);

function normalizeMachinePayload(input: string): string {
  return String(input || "")
    .replace(/[()]/g, "")
    .replace(/[\u001D\u00F1]/g, GS)
    .replace(/\s/g, "");
}

function isExpired(expiryStr: string): boolean {
  try {
    let year: number;
    let month: number;
    let day: number;

    if (expiryStr.includes("-")) {
      const parts = expiryStr.split("-");
      year = parseInt(parts[0]);
      month = parseInt(parts[1]);
      day = parseInt(parts[2]);
    } else if (expiryStr.length === 6) {
      year = 2000 + parseInt(expiryStr.substring(0, 2));
      month = parseInt(expiryStr.substring(2, 4));
      day = parseInt(expiryStr.substring(4, 6));
    } else {
      return false;
    }

    const expiryDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return expiryDate < today;
  } catch {
    return false;
  }
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

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return fail("UNAUTHORIZED", "Unauthorized", 401);
    }

    const { raw, company_id, device_context } = await req.json();
    if (company_id && company_id !== authCompanyId) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!raw) {
      return fail("VALIDATION_ERROR", "Missing raw payload", 400);
    }

    const parsedAny = parsePayload(raw);
    if (parsedAny.mode === "INVALID") {
      return fail("VALIDATION_ERROR", parsedAny.error || "Invalid payload", 400);
    }

    const data =
      parsedAny.mode === "GS1"
        ? (parsedAny.parsed as any)
        : ({
            raw,
            parsed: true,
            serialNo: parsedAny.parsed.serial,
            sscc: undefined,
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
      return fail("VALIDATION_ERROR", "Cannot resolve company_id from GS1 payload or scanned entity", 400);
    }

    let expiryStatus: "VALID" | "EXPIRED" = "VALID";
    let scanStatus: "SUCCESS" | "ERROR" = "SUCCESS";
    let errorReason: string | null = null;

    if (data.expiryDate) {
      const expired = isExpired(data.expiryDate);
      if (expired) {
        expiryStatus = "EXPIRED";
        scanStatus = "ERROR";
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
              ? compareGS1Payloads(storedPayload, raw)
              : normalizeMachinePayload(storedPayload) === normalizeMachinePayload(raw);
          if (!payloadsMatch) {
            await supabase.from("scan_logs").insert({
              company_id: unit.company_id || resolvedCompanyId,
              handset_id: null,
              raw_scan: raw,
              parsed: data,
              metadata: {
                level: "unit",
                status: "PAYLOAD_MISMATCH",
                stored_payload: codeMode === "GS1" ? normalizeGS1Payload(storedPayload) : normalizeMachinePayload(storedPayload),
                scanned_payload: codeMode === "GS1" ? normalizeGS1Payload(raw) : normalizeMachinePayload(raw),
                unit_id: unit.id,
                device_context: device_context || null,
              },
              status: "FAILED",
            });

            return fail("PAYLOAD_MISMATCH", "Payload mismatch - code may be tampered or invalid", 400);
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
      return fail("CODE_NOT_FOUND", "Code not found in hierarchy", 404);
    }

    const { data: priorScans } = await supabase
      .from("scan_logs")
      .select("id, scanned_at, metadata")
      .eq("company_id", resolvedCompanyId)
      .eq("metadata->>serial", data.serialNo || "")
      .order("scanned_at", { ascending: true })
      .limit(1);

    const isDuplicate = Boolean(priorScans && priorScans.length > 0 && data.serialNo);
    if (isDuplicate) {
      scanStatus = "SUCCESS";
    }

    const metadata: any = {
      level,
      serial: data.serialNo || null,
      expiry_status: expiryStatus,
      ...(isDuplicate ? { status: "DUPLICATE", first_scanned_at: priorScans?.[0]?.scanned_at } : {}),
      ...(device_context ? { device_context } : {}),
    };

    if (errorReason) {
      metadata.error_reason = errorReason;
    }

    await supabase.from("scan_logs").insert({
      company_id: resolvedCompanyId,
      handset_id: null,
      raw_scan: raw,
      parsed: data,
      code_id: result?.id || null,
      scanned_at: new Date().toISOString(),
      metadata,
      status: scanStatus,
    });

    return ok({
      level,
      result,
    });
  } catch (err: any) {
    return fail("INTERNAL_ERROR", err.message || String(err), 500);
  }
}

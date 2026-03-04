import { NextResponse } from "next/server";
import { parseGS1 } from "@/lib/parseGS1";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveCompanyIdFromRequest } from "@/lib/company/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractIdentifiers(input: string): { sscc?: string; serial?: string } {
  const raw = String(input || "").trim();
  if (!raw) return {};

  // Fast-path: plain 18-digit SSCC.
  if (/^\d{18}$/.test(raw)) return { sscc: raw };

  // If it looks like GS1 (human-readable or raw with AIs), parse it.
  if (raw.includes("(00)") || raw.includes("(21)") || raw.startsWith("00") || raw.startsWith("01")) {
    const parsed = parseGS1(raw);
    const sscc = parsed?.sscc;
    const serial = parsed?.serialNo;
    if (sscc || serial) return { sscc: sscc || undefined, serial: serial || undefined };
  }

  // Otherwise treat as a unit serial (our unit generator uses a serial like "Uxxxx...").
  return { serial: raw };
}

async function buildHierarchyForPallet(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  palletId: string;
  companyId: string;  // Priority 2 fix: Add company_id parameter for multi-tenant isolation
}) {
  const { supabase, palletId, companyId } = opts;

  const { data: pallet, error: palletErr } = await supabase
    .from("pallets")
    .select("id, sscc, sscc_with_ai, sku_id, created_at, meta")
    .eq("id", palletId)
    .eq("company_id", companyId)  // Priority 2 fix: Add company filter
    .single();
  if (palletErr || !pallet) return null;

  const { data: cartons } = await supabase
    .from("cartons")
    .select("id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
    .eq("company_id", companyId)  // Priority 2 fix: Add company filter
    .eq("pallet_id", palletId)
    .order("created_at", { ascending: true });

  const cartonIds = (cartons ?? []).map((c: any) => c.id).filter(Boolean);
  const { data: boxes } = cartonIds.length
    ? await supabase
        .from("boxes")
        .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
        .eq("company_id", companyId)  // Priority 2 fix: Add company filter
        .in("carton_id", cartonIds)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };

  const boxIds = (boxes ?? []).map((b: any) => b.id).filter(Boolean);
  const { data: units } = boxIds.length
    ? await supabase
        .from("labels_units")
        .select("id, box_id, serial, created_at")
        .eq("company_id", companyId)  // Priority 2 fix: Add company filter for security
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

export async function GET(req: Request) {
  try {
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code")?.trim();
    const requestedCompanyId = searchParams.get("company_id")?.trim();

    if (!code) {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }
    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = authCompanyId;

    const { sscc, serial } = extractIdentifiers(code);

    if (sscc) {
      // Pallet
      const { data: pallet } = await supabase
        .from("pallets")
        .select("id")
        .eq("company_id", companyId)
        .eq("sscc", sscc)
        .maybeSingle();
      if (pallet?.id) {
        const hierarchy = await buildHierarchyForPallet({ supabase, palletId: pallet.id, companyId });
        return NextResponse.json({ type: "pallet", level: "pallet", data: hierarchy });
      }

      // Carton
      const { data: carton } = await supabase
        .from("cartons")
        .select("id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
        .eq("company_id", companyId)
        .or(`sscc.eq.${sscc},code.eq.${sscc}`)
        .maybeSingle();
      if (carton?.id) {
        const { data: boxes } = await supabase
          .from("boxes")
          .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
          .eq("company_id", companyId)  // Priority 2 fix: Add company filter
          .eq("carton_id", carton.id)
          .order("created_at", { ascending: true });

        const boxIds = (boxes ?? []).map((b: any) => b.id).filter(Boolean);
        const { data: units } = boxIds.length
          ? await supabase
              .from("labels_units")
              .select("id, box_id, serial, created_at")
              .eq("company_id", companyId)  // Priority 2 fix: Add company filter for security
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

        const palletNode = carton.pallet_id
          ? await buildHierarchyForPallet({ supabase, palletId: carton.pallet_id, companyId })
          : null;

        return NextResponse.json({
          type: "carton",
          level: "carton",
          data: { ...(carton as any), pallet: palletNode ? { id: palletNode.id, sscc: palletNode.sscc, sscc_with_ai: palletNode.sscc_with_ai } : null, boxes: boxesWithUnits },
        });
      }

      // Box
      const { data: box } = await supabase
        .from("boxes")
        .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, sku_id, created_at, meta")
        .eq("company_id", companyId)
        .or(`sscc.eq.${sscc},code.eq.${sscc}`)
        .maybeSingle();

      if (box?.id) {
        const { data: units } = await supabase
          .from("labels_units")
          .select("id, box_id, serial, created_at")
          .eq("company_id", companyId)  // Priority 2 fix: Add company filter for security
          .eq("box_id", box.id)
          .order("created_at", { ascending: true });

        const cartonNode = box.carton_id
          ? await supabase
              .from("cartons")
              .select("id, pallet_id, sscc, sscc_with_ai, code, created_at")
              .eq("id", box.carton_id)
              .maybeSingle()
          : { data: null as any };

        const palletId = (cartonNode as any)?.data?.pallet_id ?? box.pallet_id ?? null;
        const palletNode = palletId ? await buildHierarchyForPallet({ supabase, palletId, companyId }) : null;

        return NextResponse.json({
          type: "box",
          level: "box",
          data: {
            ...(box as any),
            units: (units ?? []).map((u: any) => ({ uid: u.serial, id: u.id, created_at: u.created_at })),
            carton: (cartonNode as any)?.data ?? null,
            pallet: palletNode ? { id: palletNode.id, sscc: palletNode.sscc, sscc_with_ai: palletNode.sscc_with_ai } : null,
          },
        });
      }

      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (serial) {
      const { data: unit } = await supabase
        .from("labels_units")
        .select("id, company_id, sku_id, box_id, serial, gs1_payload, payload, code_mode, created_at")
        .eq("company_id", companyId)
        .eq("serial", serial)
        .maybeSingle();

      if (!unit?.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const boxNode = unit.box_id
        ? await supabase
            .from("boxes")
            .select("id, carton_id, pallet_id, sscc, sscc_with_ai, code, created_at")
            .eq("id", unit.box_id)
            .maybeSingle()
        : { data: null as any };

      const cartonId = (boxNode as any)?.data?.carton_id ?? null;
      const cartonNode = cartonId
        ? await supabase
            .from("cartons")
            .select("id, pallet_id, sscc, sscc_with_ai, code, created_at")
            .eq("id", cartonId)
            .maybeSingle()
        : { data: null as any };

      const palletId = (cartonNode as any)?.data?.pallet_id ?? (boxNode as any)?.data?.pallet_id ?? null;
      const palletNode = palletId ? await supabase
        .from("pallets")
        .select("id, sscc, sscc_with_ai, created_at")
        .eq("id", palletId)
        .maybeSingle() : { data: null as any };

      return NextResponse.json({
        type: "unit",
        level: "unit",
        data: {
          uid: unit.serial,
          id: unit.id,
          created_at: unit.created_at,
          gs1_payload: unit.gs1_payload,
          payload: (unit as any).payload ?? unit.gs1_payload,
          code_mode: (unit as any).code_mode ?? null,
          box: (boxNode as any)?.data ?? null,
          carton: (cartonNode as any)?.data ?? null,
          pallet: (palletNode as any)?.data ?? null,
        },
      });
    }

    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

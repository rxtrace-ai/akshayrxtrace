import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyIdFromRequest } from '@/lib/company/resolve';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { getRequestIdFromRequest } from '@/lib/http/requestId';
import { computeGs1CheckDigit } from '@/app/lib/sscc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CODES_PER_REQUEST = 10000;
const DB_INSERT_BATCH_SIZE = 1000;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDigits(input: unknown): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function normalizeDateInput(raw?: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{6}$/.test(value)) {
    const yy = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const dd = value.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }
  if (/^\d{8}$/.test(value)) {
    const dd = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const yyyy = value.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

async function resolveSkuId(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  skuIdOrCode: string;
}): Promise<string> {
  const { supabase, companyId, skuIdOrCode } = opts;
  const raw = String(skuIdOrCode || '').trim();
  if (!raw) throw new Error('sku_id is required');
  if (isUuid(raw)) return raw;

  const skuCode = raw.toUpperCase();
  const { data: skuRow, error: skuErr } = await supabase
    .from('skus')
    .select('id')
    .eq('company_id', companyId)
    .eq('sku_code', skuCode)
    .maybeSingle();

  if (skuErr) throw new Error(skuErr.message ?? 'Failed to resolve SKU');
  if (skuRow?.id) return skuRow.id;

  const { data: created, error: createErr } = await supabase
    .from('skus')
    .upsert({ company_id: companyId, sku_code: skuCode, sku_name: null, deleted_at: null }, { onConflict: 'company_id,sku_code' })
    .select('id')
    .single();

  if (createErr || !created?.id) throw new Error(createErr?.message ?? `Failed to create SKU: ${skuCode}`);
  return created.id;
}

function buildSscc(opts: { extDigit: number; companyPrefixDigits: string; serialRefDigits: string }) {
  const ext = String(Math.max(0, Math.min(9, opts.extDigit)));
  const prefix = normalizeDigits(opts.companyPrefixDigits);
  const serialRef = normalizeDigits(opts.serialRefDigits);

  // SSCC-18 structure: ext(1) + prefix + serialRef + check(1)
  // We build number17 as ext + (prefix + serialRef padded/truncated) to 16 digits.
  const body16 = (prefix + serialRef).padStart(16, '0').slice(0, 16);
  const number17 = (ext + body16).slice(0, 17);
  const check = computeGs1CheckDigit(number17);
  return number17 + check;
}

function nowSerialSeed() {
  const ts = String(Date.now()).padStart(13, '0');
  const rnd = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  return `${ts}${rnd}`;
}

export async function POST(req: Request) {
  let entitlementConsumed = false;
  let entitlementCompanyId = '';
  let entitlementQuantity = 0;

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const requestId =
      typeof (body as any)?.request_id === 'string' && String((body as any).request_id).trim()
        ? `sscc_generate:body:${String((body as any).request_id).trim()}`
        : getRequestIdFromRequest(req, 'sscc_generate');

    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      company_id: requestedCompanyId,
      sku_id,
      batch,
      expiry_date,
      units_per_box,
      boxes_per_carton,
      cartons_per_pallet,
      number_of_pallets,
      generate_box = false,
      generate_carton = false,
      generate_pallet = false,
      compliance_ack,
      sscc_company_prefix,
      sscc_extension_digit,
    } = body ?? {};

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const company_id = authCompanyId;

    if (compliance_ack !== true) {
      return NextResponse.json({ error: 'compliance_ack=true is required', code: 'compliance_required' }, { status: 400 });
    }

    if (!generate_box && !generate_carton && !generate_pallet) {
      return NextResponse.json({ error: 'At least one SSCC level must be selected (Box, Carton, Pallet)' }, { status: 400 });
    }
    if (generate_carton && !generate_box) {
      return NextResponse.json({ error: 'Carton requires Box (hierarchy enforcement).' }, { status: 400 });
    }
    if (generate_pallet && (!generate_box || !generate_carton)) {
      return NextResponse.json({ error: 'Pallet requires Box and Carton (hierarchy enforcement).' }, { status: 400 });
    }

    const normalizedExpiry = normalizeDateInput(expiry_date);
    if (!sku_id || !batch || !normalizedExpiry || !number_of_pallets) {
      return NextResponse.json({ error: 'sku_id, batch, expiry_date, and number_of_pallets are required' }, { status: 400 });
    }

    const palletsCount = Number(number_of_pallets);
    if (!Number.isFinite(palletsCount) || palletsCount <= 0 || !Number.isInteger(palletsCount)) {
      return NextResponse.json({ error: 'number_of_pallets must be a positive integer' }, { status: 400 });
    }

    const unitsPerBox = Number(units_per_box);
    if (!Number.isFinite(unitsPerBox) || unitsPerBox < 1 || !Number.isInteger(unitsPerBox)) {
      return NextResponse.json({ error: 'units_per_box must be a positive integer' }, { status: 400 });
    }

    const boxesPerCarton = generate_carton || generate_pallet ? Number(boxes_per_carton) : Number(boxes_per_carton ?? 1);
    const cartonsPerPallet = generate_pallet ? Number(cartons_per_pallet) : Number(cartons_per_pallet ?? 1);

    if ((generate_carton || generate_pallet) && (!Number.isInteger(boxesPerCarton) || boxesPerCarton < 1)) {
      return NextResponse.json({ error: 'boxes_per_carton is required when generating Carton or Pallet' }, { status: 400 });
    }
    if (generate_pallet && (!Number.isInteger(cartonsPerPallet) || cartonsPerPallet < 1)) {
      return NextResponse.json({ error: 'cartons_per_pallet is required when generating Pallet' }, { status: 400 });
    }

    const skuUuid = await resolveSkuId({ supabase, companyId: company_id, skuIdOrCode: sku_id });

    let totalSSCCCount = 0;
    if (generate_box) totalSSCCCount += palletsCount * boxesPerCarton * cartonsPerPallet;
    if (generate_carton) totalSSCCCount += palletsCount * cartonsPerPallet;
    if (generate_pallet) totalSSCCCount += palletsCount;

    if (totalSSCCCount > MAX_CODES_PER_REQUEST) {
      return NextResponse.json({ error: `Request limit exceeded (${MAX_CODES_PER_REQUEST})`, code: 'limit_exceeded' }, { status: 400 });
    }

    // Entitlement (single quota authority)
    const decision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.SSCC_LABEL,
      quantity: totalSSCCCount,
      requestId,
      metadata: { source: 'sscc_generate' },
    });
    if (!decision.allow) {
      return NextResponse.json({ error: decision.reason_code, remaining: decision.remaining }, { status: 403 });
    }
    entitlementConsumed = true;
    entitlementCompanyId = company_id;
    entitlementQuantity = totalSSCCCount;

    const prefixDigits = normalizeDigits(sscc_company_prefix || '1234567') || '1234567';
    const baseExt = Number.isInteger(Number(sscc_extension_digit)) ? Number(sscc_extension_digit) : 0;

    const meta = {
      batch,
      expiry_date: normalizedExpiry,
      units_per_box: unitsPerBox,
      boxes_per_carton: boxesPerCarton,
      cartons_per_pallet: cartonsPerPallet,
    };

    const pallets: any[] = [];
    const cartons: any[] = [];
    const boxes: any[] = [];

    // Generate hierarchy in-memory, then insert in batches.
    for (let p = 0; p < palletsCount; p++) {
      const palletSscc = generate_pallet
        ? buildSscc({ extDigit: (baseExt + 6) % 10, companyPrefixDigits: prefixDigits, serialRefDigits: nowSerialSeed() })
        : null;

      const palletRow = generate_pallet
        ? {
            company_id,
            sku_id: skuUuid,
            sscc: palletSscc,
            sscc_with_ai: `(00)${palletSscc}`,
            meta,
          }
        : null;

      // Insert placeholder now; we need pallet ids for children. We'll insert pallets first.
      if (palletRow) pallets.push(palletRow);
    }

    // Insert pallets first and capture ids (needed to link cartons/boxes).
    const insertedPallets: any[] = [];
    for (let i = 0; i < pallets.length; i += DB_INSERT_BATCH_SIZE) {
      const batchRows = pallets.slice(i, i + DB_INSERT_BATCH_SIZE);
      const { data, error } = await supabase.from('pallets').insert(batchRows).select('id, sscc, sscc_with_ai, sku_id');
      if (error) throw error;
      if (Array.isArray(data)) insertedPallets.push(...data);
    }

    const palletsForChildren = generate_pallet ? insertedPallets : Array.from({ length: palletsCount }).map(() => null);

    for (let p = 0; p < palletsCount; p++) {
      const pallet = palletsForChildren[p];
      const palletId = pallet?.id ?? null;

      const cartonsCount = generate_carton ? cartonsPerPallet : 0;
      for (let c = 0; c < cartonsCount; c++) {
        const cartonSscc = buildSscc({ extDigit: (baseExt + 3) % 10, companyPrefixDigits: prefixDigits, serialRefDigits: nowSerialSeed() });
        cartons.push({
          company_id,
          pallet_id: palletId,
          sku_id: skuUuid,
          sscc: cartonSscc,
          sscc_with_ai: `(00)${cartonSscc}`,
          code: cartonSscc,
          meta,
        });
      }
    }

    const insertedCartons: any[] = [];
    for (let i = 0; i < cartons.length; i += DB_INSERT_BATCH_SIZE) {
      const batchRows = cartons.slice(i, i + DB_INSERT_BATCH_SIZE);
      const { data, error } = await supabase.from('cartons').insert(batchRows).select('id, sscc, sscc_with_ai, sku_id, pallet_id');
      if (error) throw error;
      if (Array.isArray(data)) insertedCartons.push(...data);
    }

    // Map cartons back to pallet index order (best effort based on insertion order).
    let cartonIdx = 0;
    for (let p = 0; p < palletsCount; p++) {
      const pallet = palletsForChildren[p];
      const palletId = pallet?.id ?? null;

      const cartonsCount = generate_carton ? cartonsPerPallet : 0;
      const boxesCountPerCarton = generate_box ? boxesPerCarton : 0;

      for (let c = 0; c < cartonsCount; c++) {
        const carton = insertedCartons[cartonIdx++] ?? null;
        const cartonId = carton?.id ?? null;

        for (let b = 0; b < boxesCountPerCarton; b++) {
          const boxSscc = buildSscc({ extDigit: (baseExt + 1) % 10, companyPrefixDigits: prefixDigits, serialRefDigits: nowSerialSeed() });
          boxes.push({
            company_id,
            carton_id: cartonId,
            pallet_id: palletId,
            sku_id: skuUuid,
            sscc: boxSscc,
            sscc_with_ai: `(00)${boxSscc}`,
            code: boxSscc,
            meta,
          });
        }
      }
    }

    const insertedBoxes: any[] = [];
    for (let i = 0; i < boxes.length; i += DB_INSERT_BATCH_SIZE) {
      const batchRows = boxes.slice(i, i + DB_INSERT_BATCH_SIZE);
      const { data, error } = await supabase.from('boxes').insert(batchRows).select('id, sscc, sscc_with_ai, sku_id, pallet_id, carton_id');
      if (error) throw error;
      if (Array.isArray(data)) insertedBoxes.push(...data);
    }

    return NextResponse.json({
      ok: true,
      boxes: insertedBoxes,
      cartons: insertedCartons,
      pallets: insertedPallets,
    });
  } catch (err: any) {
    if (entitlementConsumed && entitlementCompanyId && entitlementQuantity > 0) {
      await refundEntitlement({
        companyId: entitlementCompanyId,
        usageType: UsageType.SSCC_LABEL,
        quantity: entitlementQuantity,
      }).catch(() => undefined);
    }

    return NextResponse.json({ error: err?.message || 'SSCC generation failed' }, { status: 500 });
  }
}


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
const SKU_NOT_FOUND_ERROR = 'SKU not found. Create SKU in SKU Master first.';
const SKU_GTIN_REQUIRED_ERROR = 'Selected SKU has no GTIN. SSCC generation requires a SKU with a GTIN.';

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

async function resolveSkuForSscc(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  skuCode: string;
}): Promise<{ id: string; gtin: string | null }> {
  const { supabase, companyId, skuCode } = opts;

  const normalizedSkuCode = String(skuCode || '').trim().toUpperCase();

  const { data, error } = await supabase
    .from('skus')
    .select('id, gtin')
    .eq('company_id', companyId)
    .eq('sku_code', normalizedSkuCode)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(SKU_NOT_FOUND_ERROR);
  if (!data.gtin) throw new Error(SKU_GTIN_REQUIRED_ERROR);

  return data;
}

function buildSscc(opts: {
  extDigit: number;
  companyPrefixDigits: string;
  serialRefDigits: string;
}) {
  const ext = String(opts.extDigit);
  const prefix = normalizeDigits(opts.companyPrefixDigits);
  const serialRef = normalizeDigits(opts.serialRefDigits);

  const body16 = (prefix + serialRef).padStart(16, '0').slice(0, 16);
  const number17 = (ext + body16).slice(0, 17);
  const check = computeGs1CheckDigit(number17);

  return number17 + check;
}

async function fetchSsccSerialRefs(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  count: number
): Promise<string[]> {

  const { data, error } = await supabase.rpc('next_sscc_serial_refs', { p_count: count });

  if (error) throw new Error(error.message);

  return data.map((r: any) => String(r.serial_ref_digits));
}

export async function POST(req: Request) {

  let entitlementConsumed = false;
  let entitlementCompanyId = '';
  let entitlementQuantity = 0;
  let entitlementUsageType: UsageType | null = null;

  try {

    const supabase = getSupabaseAdmin();
    const body = await req.json();

    const requestId = getRequestIdFromRequest(req, 'sscc_generate');

    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      sku_code,
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
      sscc_extension_digit
    } = body;

    if (!generate_box && !generate_carton && !generate_pallet) {
      return NextResponse.json(
        { error: 'Select at least one container type (Box, Carton, Pallet)' },
        { status: 400 }
      );
    }

    if (compliance_ack !== true)
      return NextResponse.json(
        { error: 'compliance_ack=true is required' },
        { status: 400 }
      );

    const normalizedExpiry = normalizeDateInput(expiry_date);
    const palletsCount = Number(number_of_pallets);

    const unitsPerBox = Number(units_per_box);
    const boxesPerCarton = Number(boxes_per_carton || 1);
    const cartonsPerPallet = Number(cartons_per_pallet || 1);

    const sku = await resolveSkuForSscc({
      supabase,
      companyId: authCompanyId,
      skuCode: sku_code
    });

    const skuUuid = sku.id;

    let totalSSCCCount = 0;

    if (generate_box)
      totalSSCCCount += palletsCount * boxesPerCarton;

    if (generate_carton)
      totalSSCCCount += palletsCount * cartonsPerPallet;

    if (generate_pallet)
      totalSSCCCount += palletsCount;

    const usageType =
      generate_pallet ? UsageType.PALLET_LABEL :
      generate_carton ? UsageType.CARTON_LABEL :
      UsageType.BOX_LABEL;

    const decision = await enforceEntitlement({
      companyId: authCompanyId,
      usageType,
      quantity: totalSSCCCount,
      requestId
    });

    if (!decision.allow)
      return NextResponse.json({ error: decision.reason_code }, { status: 403 });

    entitlementConsumed = true;
    entitlementCompanyId = authCompanyId;
    entitlementQuantity = totalSSCCCount;
    entitlementUsageType = usageType;

    const prefixDigits = normalizeDigits(sscc_company_prefix || '1234567');
    const baseExt = Number(sscc_extension_digit || 0);

    const serialRefs = await fetchSsccSerialRefs(supabase, totalSSCCCount);

    let refIndex = 0;
    const nextRef = () => serialRefs[refIndex++];

    const pallets:any[]=[];
    const cartons:any[]=[];
    const boxes:any[]=[];

    for (let p = 0; p < palletsCount; p++) {

      if (generate_pallet) {

        const sscc = buildSscc({
          extDigit: baseExt,
          companyPrefixDigits: prefixDigits,
          serialRefDigits: nextRef()
        });

        pallets.push({
          company_id: authCompanyId,
          sku_id: skuUuid,
          sscc,
          sscc_with_ai: `(00)${sscc}`
        });

      }

      if (generate_carton) {

        for (let c = 0; c < cartonsPerPallet; c++) {

          const sscc = buildSscc({
            extDigit: baseExt,
            companyPrefixDigits: prefixDigits,
            serialRefDigits: nextRef()
          });

          cartons.push({
            company_id: authCompanyId,
            sku_id: skuUuid,
            sscc,
            sscc_with_ai: `(00)${sscc}`
          });

        }

      }

      if (generate_box) {

        for (let b = 0; b < boxesPerCarton; b++) {

          const sscc = buildSscc({
            extDigit: baseExt,
            companyPrefixDigits: prefixDigits,
            serialRefDigits: nextRef()
          });

          boxes.push({
            company_id: authCompanyId,
            sku_id: skuUuid,
            sscc,
            sscc_with_ai: `(00)${sscc}`
          });

        }

      }

    }

    const insertedPallets =
      pallets.length
        ? (await supabase.from('pallets').insert(pallets).select()).data
        : [];

    const insertedCartons =
      cartons.length
        ? (await supabase.from('cartons').insert(cartons).select()).data
        : [];

    const insertedBoxes =
      boxes.length
        ? (await supabase.from('boxes').insert(boxes).select()).data
        : [];

    return NextResponse.json({
      ok: true,
      pallets: insertedPallets,
      cartons: insertedCartons,
      boxes: insertedBoxes
    });

  } catch (err:any) {

    if (entitlementConsumed && entitlementUsageType) {

      await refundEntitlement({
        companyId: entitlementCompanyId,
        usageType: entitlementUsageType,
        quantity: entitlementQuantity
      });

    }

    if (err?.message === SKU_NOT_FOUND_ERROR)
      return NextResponse.json({ error: err.message }, { status: 404 });

    if (err?.message === SKU_GTIN_REQUIRED_ERROR)
      return NextResponse.json({ error: err.message }, { status: 400 });

    return NextResponse.json(
      { error: err?.message || 'SSCC generation failed' },
      { status: 500 }
    );
  }
}

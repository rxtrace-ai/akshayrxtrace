import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyIdFromRequest } from '@/lib/company/resolve';
import { consumeEntitlementBatch, refundEntitlementBatch, type EntitlementBatchItem } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { getRequestIdFromRequest } from '@/lib/http/requestId';
import { computeGs1CheckDigit } from '@/app/lib/sscc';
import { fail, ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CODES_PER_REQUEST = 10000;
const LEGACY_SSCC_FIELDS = ['sku_code', 'batch', 'expiry_date', 'company_id'] as const;
const SKU_NOT_FOUND_ERROR = 'SKU Master record not found. Create or refresh SKU Master and try again.';
const SKU_GTIN_REQUIRED_ERROR = 'Selected SKU has no GTIN. SSCC generation requires a SKU with a GTIN.';

function normalizeDigits(input: unknown): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

async function resolveSkuForSscc(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  unitSkuMasterId: string;
}): Promise<{ skuCode: string; gtin: string; legacySkuId: string | null }> {
  const { supabase, companyId, unitSkuMasterId } = opts;

  const { data: unitMaster, error: unitMasterError } = await supabase
    .from('unit_sku_master')
    .select('sku_code, gtin')
    .eq('company_id', companyId)
    .eq('id', unitSkuMasterId)
    .is('deleted_at', null)
    .maybeSingle();

  if (unitMasterError) throw new Error(unitMasterError.message);

  const skuCode = String(unitMaster?.sku_code || '').trim().toUpperCase();
  const gtin = String(unitMaster?.gtin || '').trim();

  if (!skuCode) throw new Error(SKU_NOT_FOUND_ERROR);
  if (!gtin) throw new Error(SKU_GTIN_REQUIRED_ERROR);

  const { data: legacySku, error: legacySkuError } = await supabase
    .from('skus')
    .select('id')
    .eq('company_id', companyId)
    .eq('sku_code', skuCode)
    .is('deleted_at', null)
    .maybeSingle();

  if (legacySkuError) throw new Error(legacySkuError.message);

  return {
    skuCode,
    gtin,
    legacySkuId: legacySku?.id ?? null,
  };
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
  let consumedEntitlements: EntitlementBatchItem[] = [];
  let entitlementCompanyId = '';

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const requestId = getRequestIdFromRequest(req, 'sscc_generate');

    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return fail('UNAUTHORIZED', 'Unauthorized', 401);
    }

    const {
      unit_sku_master_id,
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
    } = body;

    const legacyFieldsProvided = LEGACY_SSCC_FIELDS.filter((field) => body?.[field] !== undefined);
    if (legacyFieldsProvided.length > 0) {
      console.warn('[sscc_generate] legacy_request_shape_rejected', {
        company_id: authCompanyId,
        request_id: requestId,
        fields: legacyFieldsProvided,
      });
      return fail(
        'VALIDATION_ERROR',
        'SSCC generation now requires a valid SKU Master selection. Direct fixed-field SSCC generation is no longer supported.',
        400
      );
    }

    if (typeof unit_sku_master_id !== 'string' || unit_sku_master_id.trim().length === 0) {
      return fail('VALIDATION_ERROR', 'unit_sku_master_id is required', 400);
    }

    if (!generate_box && !generate_carton && !generate_pallet) {
      return fail('VALIDATION_ERROR', 'Select at least one container type (Box, Carton, Pallet)', 400);
    }

    if (compliance_ack !== true) {
      return fail('VALIDATION_ERROR', 'compliance_ack=true is required', 400);
    }

    const palletsCount = Number(number_of_pallets);
    const unitsPerBox = Number(units_per_box);
    const boxesPerCarton = Number(boxes_per_carton || 1);
    const cartonsPerPallet = Number(cartons_per_pallet || 1);

    if (!Number.isInteger(palletsCount) || palletsCount <= 0) {
      return fail('VALIDATION_ERROR', 'number_of_pallets must be a positive integer', 400);
    }
    if (generate_box && (!Number.isInteger(unitsPerBox) || unitsPerBox <= 0)) {
      return fail('VALIDATION_ERROR', 'units_per_box must be a positive integer', 400);
    }
    if ((generate_box || generate_carton) && (!Number.isInteger(boxesPerCarton) || boxesPerCarton <= 0)) {
      return fail('VALIDATION_ERROR', 'boxes_per_carton must be a positive integer', 400);
    }
    if ((generate_box || generate_carton || generate_pallet) && (!Number.isInteger(cartonsPerPallet) || cartonsPerPallet <= 0)) {
      return fail('VALIDATION_ERROR', 'cartons_per_pallet must be a positive integer', 400);
    }

    const sku = await resolveSkuForSscc({
      supabase,
      companyId: authCompanyId,
      unitSkuMasterId: unit_sku_master_id.trim(),
    });

    const skuUuid = sku.legacySkuId;
    if (!skuUuid) {
      console.info('[sscc_generate] legacy_sku_reference_missing', {
        company_id: authCompanyId,
        request_id: requestId,
        unit_sku_master_id,
      });
    }

    const boxCount = generate_box ? palletsCount * cartonsPerPallet * boxesPerCarton : 0;
    const cartonCount = generate_carton ? palletsCount * cartonsPerPallet : 0;
    const palletCount = generate_pallet ? palletsCount : 0;
    const totalSSCCCount = boxCount + cartonCount + palletCount;

    if (totalSSCCCount > MAX_CODES_PER_REQUEST) {
      return fail('VALIDATION_ERROR', `Requested SSCC volume exceeds limit (${MAX_CODES_PER_REQUEST})`, 400);
    }

    const consumption = await consumeEntitlementBatch({
      companyId: authCompanyId,
      items: [
        {
          usageType: UsageType.BOX_LABEL,
          quantity: boxCount,
          requestId: `${requestId}:box`,
          metadata: { source: 'sscc_generate', level: 'box', unit_sku_master_id: unit_sku_master_id.trim() },
        },
        {
          usageType: UsageType.CARTON_LABEL,
          quantity: cartonCount,
          requestId: `${requestId}:carton`,
          metadata: { source: 'sscc_generate', level: 'carton', unit_sku_master_id: unit_sku_master_id.trim() },
        },
        {
          usageType: UsageType.PALLET_LABEL,
          quantity: palletCount,
          requestId: `${requestId}:pallet`,
          metadata: { source: 'sscc_generate', level: 'pallet', unit_sku_master_id: unit_sku_master_id.trim() },
        },
      ],
    });

    if (!consumption.ok) {
      const isQuotaError = String(consumption.error || '').toUpperCase().includes('QUOTA_EXCEEDED');
      return fail(
        String(consumption.error || 'QUOTA_EXCEEDED'),
        isQuotaError ? 'Quota exceeded. Please purchase add-ons.' : String(consumption.error || 'QUOTA_EXCEEDED'),
        403
      );
    }

    entitlementCompanyId = authCompanyId;
    consumedEntitlements = consumption.consumed;

    const prefixDigits = normalizeDigits(sscc_company_prefix || '1234567');
    const baseExt = Number(sscc_extension_digit || 0);
    const serialRefs = await fetchSsccSerialRefs(supabase, totalSSCCCount);

    let refIndex = 0;
    const nextRef = () => serialRefs[refIndex++];

    const pallets: any[] = [];
    const cartons: any[] = [];
    const boxes: any[] = [];

    for (let p = 0; p < palletsCount; p++) {
      if (generate_pallet) {
        const sscc = buildSscc({
          extDigit: baseExt,
          companyPrefixDigits: prefixDigits,
          serialRefDigits: nextRef(),
        });

        pallets.push({
          company_id: authCompanyId,
          sku_id: skuUuid,
          sscc,
          sscc_with_ai: `(00)${sscc}`,
        });
      }

      if (generate_carton) {
        for (let c = 0; c < cartonsPerPallet; c++) {
          const sscc = buildSscc({
            extDigit: baseExt,
            companyPrefixDigits: prefixDigits,
            serialRefDigits: nextRef(),
          });

          cartons.push({
            company_id: authCompanyId,
            sku_id: skuUuid,
            sscc,
            sscc_with_ai: `(00)${sscc}`,
          });
        }
      }

      if (generate_box) {
        for (let c = 0; c < cartonsPerPallet; c++) {
          for (let b = 0; b < boxesPerCarton; b++) {
            const sscc = buildSscc({
              extDigit: baseExt,
              companyPrefixDigits: prefixDigits,
              serialRefDigits: nextRef(),
            });

            boxes.push({
              company_id: authCompanyId,
              sku_id: skuUuid,
              sscc,
              sscc_with_ai: `(00)${sscc}`,
            });
          }
        }
      }
    }

    const insertedPallets = pallets.length
      ? (await supabase.from('pallets').insert(pallets).select()).data
      : [];

    const insertedCartons = cartons.length
      ? (await supabase.from('cartons').insert(cartons).select()).data
      : [];

    const insertedBoxes = boxes.length
      ? (await supabase.from('boxes').insert(boxes).select()).data
      : [];

    return ok({
      pallets: insertedPallets,
      cartons: insertedCartons,
      boxes: insertedBoxes,
    });
  } catch (err: any) {
    if (consumedEntitlements.length > 0) {
      await refundEntitlementBatch({
        companyId: entitlementCompanyId,
        items: consumedEntitlements,
      });
    }

    if (err?.message === SKU_NOT_FOUND_ERROR) {
      return fail('NOT_FOUND', err.message, 404);
    }

    if (err?.message === SKU_GTIN_REQUIRED_ERROR) {
      return fail('VALIDATION_ERROR', err.message, 400);
    }

    return fail('INTERNAL_ERROR', err?.message || 'SSCC generation failed', 500);
  }
}

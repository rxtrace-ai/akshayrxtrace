import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { resolveCompanyIdFromRequest } from '@/lib/company/resolve';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { computeGs1CheckDigit } from '@/app/lib/sscc';
import { checkUserIdempotency, hashRequestBody, storeUserIdempotencyResponse } from '@/lib/user/idempotency';
import { createCodeGenerationBatch, updateCodeGenerationBatch } from '@/lib/codeGeneration/batches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CODES_PER_REQUEST = 1000;
const IDEMPOTENCY_ENDPOINT = 'sscc_generate';
const LEGACY_SSCC_FIELDS = ['sku_code', 'batch', 'expiry_date', 'company_id'] as const;
const SKU_NOT_FOUND_ERROR = 'SKU Master record not found. Create or refresh SKU Master and try again.';
const SKU_GTIN_REQUIRED_ERROR = 'Selected SKU has no GTIN. SSCC generation requires a SKU with a GTIN.';

type PalletRow = {
  id?: string;
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string;
  generation_batch_id: string;
  sscc: string;
  sscc_with_ai: string;
};

type CartonRow = {
  id?: string;
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string;
  generation_batch_id: string;
  pallet_id: string | null;
  sscc: string;
  sscc_with_ai: string;
};

type BoxRow = {
  id?: string;
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string;
  generation_batch_id: string;
  carton_id: string | null;
  pallet_id: string | null;
  sscc: string;
  sscc_with_ai: string;
};

function normalizeDigits(input: unknown): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

function errorResponse(code: string, message: string, status: number) {
  return {
    payload: {
      success: false,
      error: {
        code,
        message,
      },
    },
    status,
  };
}

function successResponse(payload: Record<string, unknown>) {
  return {
    payload: {
      success: true,
      data: payload,
      ...payload,
    },
    status: 200,
  };
}

async function resolveSkuForSscc(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  unitSkuMasterId: string;
}): Promise<{ skuCode: string; gtin: string; batch: string; legacySkuId: string | null }> {
  const { supabase, companyId, unitSkuMasterId } = opts;

  const { data: unitMaster, error: unitMasterError } = await supabase
    .from('unit_sku_master')
    .select('sku_code, gtin, batch')
    .eq('company_id', companyId)
    .eq('id', unitSkuMasterId)
    .is('deleted_at', null)
    .maybeSingle();

  if (unitMasterError) throw new Error(unitMasterError.message);

  const skuCode = String(unitMaster?.sku_code || '').trim().toUpperCase();
  const gtin = String(unitMaster?.gtin || '').trim();
  const batch = String(unitMaster?.batch || '').trim();

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
    batch,
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
  const serialLength = Math.max(1, 16 - prefix.length);
  const serialBody = serialRef.padStart(serialLength, '0').slice(-serialLength);
  const body16 = (prefix + serialBody).padStart(16, '0').slice(-16);
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
  return data.map((row: any) => String(row.serial_ref_digits));
}

async function storeReplay(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  idempotencyKey: string | null;
  requestHash: string;
  payload: any;
  status: number;
}) {
  if (!params.idempotencyKey) return;
  await storeUserIdempotencyResponse({
    supabase: params.supabase,
    userId: params.userId,
    endpoint: IDEMPOTENCY_ENDPOINT,
    idempotencyKey: params.idempotencyKey,
    requestHash: params.requestHash,
    statusCode: params.status,
    payload: params.payload,
    correlationId: params.idempotencyKey,
  });
}

async function consumeLevelQuota(params: {
  companyId: string;
  usageType: UsageType;
  quantity: number;
  requestId: string;
  metadata: Record<string, any>;
}) {
  if (params.quantity <= 0) return { ok: true, code: null as string | null };
  const decision = await enforceEntitlement({
    companyId: params.companyId,
    usageType: params.usageType,
    quantity: params.quantity,
    requestId: params.requestId,
    metadata: params.metadata,
  });
  if (!decision.allow) {
    return {
      ok: false,
      code: String(decision.reason_code || 'QUOTA_EXCEEDED'),
    };
  }
  return { ok: true, code: null as string | null };
}

export async function POST(req: Request) {
  let batchLog: { id: string; batchNo: string } | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const server = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await server.auth.getUser();

    if (authError || !user) {
      const response = errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      const response = errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const body = await req.json();
    const idempotencyKey =
      req.headers.get('Idempotency-Key') ||
      req.headers.get('idempotency-key') ||
      req.headers.get('x-idempotency-key') ||
      null;
    const requestHash = hashRequestBody(body);
    const idempotency = await checkUserIdempotency({
      supabase,
      userId: user.id,
      endpoint: IDEMPOTENCY_ENDPOINT,
      idempotencyKey,
      requestHash,
    });

    if (idempotency.kind === 'conflict') {
      const response = errorResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different request payload', 409);
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (idempotency.kind === 'replay') {
      return NextResponse.json(idempotency.payload, { status: idempotency.statusCode });
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
      code_type,
      sscc_company_prefix,
      sscc_extension_digit,
    } = body;

    const legacyFieldsProvided = LEGACY_SSCC_FIELDS.filter((field) => body?.[field] !== undefined);
    if (legacyFieldsProvided.length > 0) {
      const response = errorResponse(
        'VALIDATION_ERROR',
        'SSCC generation now requires a valid SKU Master selection. Direct fixed-field SSCC generation is no longer supported.',
        400
      );
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (typeof unit_sku_master_id !== 'string' || unit_sku_master_id.trim().length === 0) {
      const response = errorResponse('VALIDATION_ERROR', 'unit_sku_master_id is required', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (!generate_box && !generate_carton && !generate_pallet) {
      const response = errorResponse('VALIDATION_ERROR', 'Select at least one container type (Box, Carton, Pallet)', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (compliance_ack !== true) {
      const response = errorResponse('VALIDATION_ERROR', 'compliance_ack=true is required', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const palletsCount = Number(number_of_pallets);
    const unitsPerBox = Number(units_per_box);
    const boxesPerCarton = Number(boxes_per_carton || 1);
    const cartonsPerPallet = Number(cartons_per_pallet || 1);

    if (!Number.isInteger(palletsCount) || palletsCount <= 0) {
      const response = errorResponse('VALIDATION_ERROR', 'number_of_pallets must be a positive integer', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }
    if (generate_box && (!Number.isInteger(unitsPerBox) || unitsPerBox <= 0)) {
      const response = errorResponse('VALIDATION_ERROR', 'units_per_box must be a positive integer', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }
    if ((generate_box || generate_carton) && (!Number.isInteger(boxesPerCarton) || boxesPerCarton <= 0)) {
      const response = errorResponse('VALIDATION_ERROR', 'boxes_per_carton must be a positive integer', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }
    if ((generate_box || generate_carton || generate_pallet) && (!Number.isInteger(cartonsPerPallet) || cartonsPerPallet <= 0)) {
      const response = errorResponse('VALIDATION_ERROR', 'cartons_per_pallet must be a positive integer', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const sku = await resolveSkuForSscc({
      supabase,
      companyId: authCompanyId,
      unitSkuMasterId: unit_sku_master_id.trim(),
    });
    const symbolType = code_type === 'QR' || code_type === 'DATAMATRIX' ? code_type : null;

    const boxCount = generate_box ? palletsCount * cartonsPerPallet * boxesPerCarton : 0;
    const cartonCount = generate_carton ? palletsCount * cartonsPerPallet : 0;
    const palletCount = generate_pallet ? palletsCount : 0;
    const totalSSCCCount = boxCount + cartonCount + palletCount;

    if (totalSSCCCount > MAX_CODES_PER_REQUEST) {
      const response = errorResponse('VALIDATION_ERROR', `Requested SSCC volume exceeds limit (${MAX_CODES_PER_REQUEST})`, 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const prefixDigits = normalizeDigits(sscc_company_prefix || '1234567');
    const baseExt = Number(sscc_extension_digit || 0);
    batchLog = await createCodeGenerationBatch({
      companyId: authCompanyId,
      generationFamily: 'SSCC',
      source: 'MANUAL',
      unitSkuMasterId: unit_sku_master_id.trim(),
      skuId: sku.legacySkuId,
      skuCodeSnapshot: sku.skuCode,
      gtinSnapshot: sku.gtin,
      productBatchSnapshot: sku.batch || null,
      codeMode: 'GS1',
      symbolType,
      requestedQty: totalSSCCCount,
      requestId: idempotency.kind === 'ok' ? idempotency.key : idempotencyKey,
      createdBy: user.id,
      meta: {
        source: 'sscc_generate',
        units_per_box: unitsPerBox,
        boxes_per_carton: boxesPerCarton,
        cartons_per_pallet: cartonsPerPallet,
        number_of_pallets: palletsCount,
      },
    });
    const batchLogId = batchLog.id;
    const batchNo = batchLog.batchNo;
    const serialRefs = await fetchSsccSerialRefs(supabase, totalSSCCCount);
    let refIndex = 0;
    const nextRef = () => serialRefs[refIndex++];

    const palletDrafts: PalletRow[] = [];
    const cartonDraftGroups: CartonRow[][] = [];
    const boxDraftGroups: BoxRow[][] = [];

    for (let palletIdx = 0; palletIdx < palletsCount; palletIdx++) {
      let palletDraft: PalletRow | null = null;
      if (generate_pallet) {
        const sscc = buildSscc({
          extDigit: baseExt,
          companyPrefixDigits: prefixDigits,
          serialRefDigits: nextRef(),
        });
        palletDraft = {
          company_id: authCompanyId,
          sku_id: sku.legacySkuId,
          unit_sku_master_id: unit_sku_master_id.trim(),
          generation_batch_id: batchLogId,
          sscc,
          sscc_with_ai: `(00)${sscc}`,
        };
        palletDrafts.push(palletDraft);
      }

      const cartonsForPallet: CartonRow[] = [];
      const boxesForPallet: BoxRow[] = [];

      for (let cartonIdx = 0; cartonIdx < cartonsPerPallet; cartonIdx++) {
        let cartonDraft: CartonRow | null = null;
        if (generate_carton) {
          const sscc = buildSscc({
            extDigit: baseExt,
            companyPrefixDigits: prefixDigits,
            serialRefDigits: nextRef(),
          });
          cartonDraft = {
            company_id: authCompanyId,
            sku_id: sku.legacySkuId,
            unit_sku_master_id: unit_sku_master_id.trim(),
            generation_batch_id: batchLogId,
            pallet_id: null,
            sscc,
            sscc_with_ai: `(00)${sscc}`,
          };
          cartonsForPallet.push(cartonDraft);
        }

        if (generate_box) {
          for (let boxIdx = 0; boxIdx < boxesPerCarton; boxIdx++) {
            const sscc = buildSscc({
              extDigit: baseExt,
              companyPrefixDigits: prefixDigits,
              serialRefDigits: nextRef(),
            });
            boxesForPallet.push({
              company_id: authCompanyId,
              sku_id: sku.legacySkuId,
              unit_sku_master_id: unit_sku_master_id.trim(),
              generation_batch_id: batchLogId,
              carton_id: null,
              pallet_id: null,
              sscc,
              sscc_with_ai: `(00)${sscc}`,
            });
          }
        }
      }

      cartonDraftGroups.push(cartonsForPallet);
      boxDraftGroups.push(boxesForPallet);
    }

    const requestKey = `${IDEMPOTENCY_ENDPOINT}:${idempotency.kind === 'ok' ? idempotency.key : 'gen'}`;
    let palletQuotaConsumed = false;
    let cartonQuotaConsumed = false;
    let boxQuotaConsumed = false;
    const insertedPalletIds: string[] = [];
    const insertedCartonIds: string[] = [];
    const insertedBoxIds: string[] = [];

    const rollbackGeneration = async () => {
      if (insertedBoxIds.length > 0) {
        await supabase.from('boxes').delete().in('id', insertedBoxIds);
      }
      if (insertedCartonIds.length > 0) {
        await supabase.from('cartons').delete().in('id', insertedCartonIds);
      }
      if (insertedPalletIds.length > 0) {
        await supabase.from('pallets').delete().in('id', insertedPalletIds);
      }
      if (boxQuotaConsumed) {
        await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.BOX_LABEL, quantity: boxCount });
      }
      if (cartonQuotaConsumed) {
        await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.CARTON_LABEL, quantity: cartonCount });
      }
      if (palletQuotaConsumed) {
        await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.PALLET_LABEL, quantity: palletCount });
      }
    };

    if (palletCount > 0) {
      const consumePallets = await consumeLevelQuota({
        companyId: authCompanyId,
        usageType: UsageType.PALLET_LABEL,
        quantity: palletCount,
        requestId: `${requestKey}:pallet`,
        metadata: { source: 'sscc_generate', level: 'pallet', unit_sku_master_id: unit_sku_master_id.trim() },
      });

      if (!consumePallets.ok) {
        await updateCodeGenerationBatch({
          batchId: batchLogId,
          status: 'FAILED',
          generatedQty: 0,
          failedQty: totalSSCCCount,
          meta: { source: 'sscc_generate', reason_code: consumePallets.code || 'QUOTA_EXCEEDED' },
        });
        const response = errorResponse(consumePallets.code || 'QUOTA_EXCEEDED', 'Quota exceeded. Please purchase add-ons.', 403);
        return NextResponse.json(response.payload, { status: response.status });
      }
      palletQuotaConsumed = true;
    }

    if (cartonCount > 0) {
      const consumeCartons = await consumeLevelQuota({
        companyId: authCompanyId,
        usageType: UsageType.CARTON_LABEL,
        quantity: cartonCount,
        requestId: `${requestKey}:carton`,
        metadata: { source: 'sscc_generate', level: 'carton', unit_sku_master_id: unit_sku_master_id.trim() },
      });

      if (!consumeCartons.ok) {
        await updateCodeGenerationBatch({
          batchId: batchLogId,
          status: 'FAILED',
          generatedQty: 0,
          failedQty: totalSSCCCount,
          meta: { source: 'sscc_generate', reason_code: consumeCartons.code || 'QUOTA_EXCEEDED' },
        });
        if (palletQuotaConsumed) {
          await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.PALLET_LABEL, quantity: palletCount });
        }
        const response = errorResponse(consumeCartons.code || 'QUOTA_EXCEEDED', 'Quota exceeded. Please purchase add-ons.', 403);
        return NextResponse.json(response.payload, { status: response.status });
      }
      cartonQuotaConsumed = true;
    }

    if (boxCount > 0) {
      const consumeBoxes = await consumeLevelQuota({
        companyId: authCompanyId,
        usageType: UsageType.BOX_LABEL,
        quantity: boxCount,
        requestId: `${requestKey}:box`,
        metadata: { source: 'sscc_generate', level: 'box', unit_sku_master_id: unit_sku_master_id.trim() },
      });

      if (!consumeBoxes.ok) {
        await updateCodeGenerationBatch({
          batchId: batchLogId,
          status: 'FAILED',
          generatedQty: 0,
          failedQty: totalSSCCCount,
          meta: { source: 'sscc_generate', reason_code: consumeBoxes.code || 'QUOTA_EXCEEDED' },
        });
        if (cartonQuotaConsumed) {
          await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.CARTON_LABEL, quantity: cartonCount });
        }
        if (palletQuotaConsumed) {
          await refundEntitlement({ companyId: authCompanyId, usageType: UsageType.PALLET_LABEL, quantity: palletCount });
        }
        const response = errorResponse(consumeBoxes.code || 'QUOTA_EXCEEDED', 'Quota exceeded. Please purchase add-ons.', 403);
        return NextResponse.json(response.payload, { status: response.status });
      }
      boxQuotaConsumed = true;
    }

    const insertedPallets = palletDrafts.length
      ? ((await supabase.from('pallets').insert(palletDrafts).select()).data as PalletRow[] | null) ?? []
      : [];

    insertedPalletIds.push(...insertedPallets.map((row) => row.id || '').filter(Boolean));

    if (palletDrafts.length && insertedPallets.length !== palletDrafts.length) {
      await updateCodeGenerationBatch({
        batchId: batchLogId,
        status: 'FAILED',
        generatedQty: 0,
        failedQty: totalSSCCCount,
        meta: { source: 'sscc_generate', error: 'Failed to insert all pallet SSCC labels' },
      });
      await rollbackGeneration();
      throw new Error('Failed to insert all pallet SSCC labels');
    }

    const palletIdByIndex = insertedPallets.map((row) => row.id || null);
    const cartonsToInsert: CartonRow[] = [];
    for (let palletIdx = 0; palletIdx < cartonDraftGroups.length; palletIdx++) {
      for (const carton of cartonDraftGroups[palletIdx]) {
        cartonsToInsert.push({
          ...carton,
          pallet_id: generate_pallet ? palletIdByIndex[palletIdx] ?? null : null,
        });
      }
    }

    const insertedCartons = cartonsToInsert.length
      ? ((await supabase.from('cartons').insert(cartonsToInsert).select()).data as CartonRow[] | null) ?? []
      : [];

    insertedCartonIds.push(...insertedCartons.map((row) => row.id || '').filter(Boolean));

    if (cartonsToInsert.length && insertedCartons.length !== cartonsToInsert.length) {
      await updateCodeGenerationBatch({
        batchId: batchLogId,
        status: 'FAILED',
        generatedQty: 0,
        failedQty: totalSSCCCount,
        meta: { source: 'sscc_generate', error: 'Failed to insert all carton SSCC labels' },
      });
      await rollbackGeneration();
      throw new Error('Failed to insert all carton SSCC labels');
    }

    let insertedCartonIndex = 0;
    const boxesToInsert: BoxRow[] = [];
    for (let palletIdx = 0; palletIdx < boxDraftGroups.length; palletIdx++) {
      for (let cartonIdx = 0; cartonIdx < boxDraftGroups[palletIdx].length; cartonIdx += boxesPerCarton) {
        const linkedCartonId =
          generate_carton
            ? insertedCartons[insertedCartonIndex++]?.id ?? null
            : null;
        for (let boxOffset = 0; boxOffset < boxesPerCarton; boxOffset++) {
          const box = boxDraftGroups[palletIdx][cartonIdx + boxOffset];
          if (!box) continue;
          boxesToInsert.push({
            ...box,
            carton_id: linkedCartonId,
            pallet_id: generate_pallet ? palletIdByIndex[palletIdx] ?? null : null,
          });
        }
      }
    }

    const insertedBoxes = boxesToInsert.length
      ? ((await supabase.from('boxes').insert(boxesToInsert).select()).data as BoxRow[] | null) ?? []
      : [];

    insertedBoxIds.push(...insertedBoxes.map((row) => row.id || '').filter(Boolean));

    if (boxesToInsert.length && insertedBoxes.length !== boxesToInsert.length) {
      await updateCodeGenerationBatch({
        batchId: batchLogId,
        status: 'FAILED',
        generatedQty: 0,
        failedQty: totalSSCCCount,
        meta: { source: 'sscc_generate', error: 'Failed to insert all box SSCC labels' },
      });
      await rollbackGeneration();
      throw new Error('Failed to insert all box SSCC labels');
    }

    await updateCodeGenerationBatch({
      batchId: batchLogId,
      status: 'SUCCESS',
      generatedQty: totalSSCCCount,
      failedQty: 0,
      meta: {
        source: 'sscc_generate',
        box_count: boxCount,
        carton_count: cartonCount,
        pallet_count: palletCount,
      },
    });

    const response = successResponse({
      batch_no: batchNo,
      status: 'SUCCESS',
      pallets: insertedPallets,
      cartons: insertedCartons,
      boxes: insertedBoxes,
    });

    if (idempotency.kind === 'ok') {
      try {
        await storeReplay({
          supabase,
          userId: user.id,
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          payload: response.payload,
          status: response.status,
        });
      } catch (replayError) {
        console.error('[sscc/generate] failed to persist idempotency replay response', replayError);
      }
    }

    return NextResponse.json(response.payload, { status: response.status });
  } catch (err: any) {
    if (batchLog) {
      try {
        await updateCodeGenerationBatch({
          batchId: batchLog.id,
          status: 'FAILED',
          meta: {
            source: 'sscc_generate',
            error: String(err?.message || err),
          },
        });
      } catch {}
    }
    if (err?.message === SKU_NOT_FOUND_ERROR) {
      const response = errorResponse('NOT_FOUND', err.message, 404);
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (err?.message === SKU_GTIN_REQUIRED_ERROR) {
      const response = errorResponse('VALIDATION_ERROR', err.message, 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const response = errorResponse('INTERNAL_ERROR', err?.message || 'SSCC generation failed', 500);
    return NextResponse.json(response.payload, { status: response.status });
  }
}

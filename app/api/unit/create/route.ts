import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { generateCanonicalGS1 } from '@/lib/gs1Canonical';
import { resolveCodeMode } from '@/lib/codeMode';
import { buildPicUnitPayload } from '@/lib/picPayload';
import { resolveCompanyIdFromRequest } from '@/lib/company/resolve';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { generateUnitSerial } from '@/lib/serial/unitSerial';
import { checkUserIdempotency, hashRequestBody, storeUserIdempotencyResponse } from '@/lib/user/idempotency';

const MAX_UNITS_PER_REQUEST = 10000;
const DB_INSERT_BATCH_SIZE = 1000;
const MAX_SERIAL_RETRY_ATTEMPTS = 5;
const IDEMPOTENCY_ENDPOINT = 'unit_create';
const LEGACY_UNIT_FIELDS = [
  'sku_code',
  'sku_name',
  'gtin',
  'batch',
  'mfd',
  'expiry',
  'mrp',
  'company_name',
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
  code_mode: 'GS1' | 'PIC';
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

function isUniqueViolation(error: any) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('unique');
}

async function maybeStoreSuccessfulReplay(params: {
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

export async function POST(req: Request) {
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
      company_id: requestedCompanyId,
      quantity,
      compliance_ack,
    } = body;

    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      const response = errorResponse('FORBIDDEN', 'Forbidden', 403);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const legacyFieldsProvided = LEGACY_UNIT_FIELDS.filter((field) => body?.[field] !== undefined);
    if (legacyFieldsProvided.length > 0) {
      const response = errorResponse(
        'VALIDATION_ERROR',
        'Unit generation now requires a valid SKU Master selection. Direct fixed-field Unit generation is no longer supported.',
        400
      );
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (typeof unit_sku_master_id !== 'string' || unit_sku_master_id.trim().length === 0) {
      const response = errorResponse(
        'VALIDATION_ERROR',
        'unit_sku_master_id is required. Select a valid SKU Master record and try again.',
        400
      );
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (!compliance_ack) {
      const response = errorResponse('VALIDATION_ERROR', 'compliance_ack=true is required', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      const response = errorResponse('VALIDATION_ERROR', 'quantity must be a positive integer', 400);
      return NextResponse.json(response.payload, { status: response.status });
    }
    if (qty > MAX_UNITS_PER_REQUEST) {
      const response = errorResponse('VALIDATION_ERROR', `quantity exceeds limit (${MAX_UNITS_PER_REQUEST})`, 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const { data: unitMaster, error: unitMasterError } = await supabase
      .from('unit_sku_master')
      .select('id, sku_code, gtin, batch, mfd, expiry, mrp')
      .eq('id', unit_sku_master_id.trim())
      .eq('company_id', authCompanyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (unitMasterError) {
      const response = errorResponse('VALIDATION_ERROR', unitMasterError.message, 400);
      return NextResponse.json(response.payload, { status: response.status });
    }

    if (!unitMaster) {
      const response = errorResponse('NOT_FOUND', 'Selected SKU Master record not found or is inactive. Refresh the page and try again.', 404);
      return NextResponse.json(response.payload, { status: response.status });
    }

    const masterSnapshot: UnitMasterSnapshot = {
      sku_code: String(unitMaster.sku_code ?? '').trim(),
      gtin: typeof unitMaster.gtin === 'string' ? unitMaster.gtin.trim() : null,
      batch: String(unitMaster.batch ?? '').trim(),
      mfd: typeof unitMaster.mfd === 'string' ? unitMaster.mfd : null,
      expiry: String(unitMaster.expiry ?? '').trim(),
      mrp: unitMaster.mrp == null ? null : String(unitMaster.mrp),
    };

    const resolvedSkuCode = masterSnapshot.sku_code;
    const resolvedBatch = masterSnapshot.batch;
    const resolvedExpiry = masterSnapshot.expiry;
    const resolvedMfd = String(masterSnapshot.mfd ?? '').trim() || resolvedExpiry;
    const resolvedMrp = masterSnapshot.mrp;
    const resolvedGtinRaw = typeof masterSnapshot.gtin === 'string' ? masterSnapshot.gtin : '';

    if (!resolvedSkuCode || !resolvedBatch || !resolvedExpiry) {
      const response = errorResponse(
        'VALIDATION_ERROR',
        'Selected SKU Master record is incomplete. Create a new valid SKU Master record and try again.',
        400
      );
      return NextResponse.json(response.payload, { status: response.status });
    }

    const codeMode = resolveCodeMode({ gtin: resolvedGtinRaw || null });
    let gtinForStorage = resolvedGtinRaw;
    const normalizedSkuCode = String(resolvedSkuCode).trim().toUpperCase();

    if (codeMode === 'GS1') {
      const { validateGTIN } = await import('@/lib/gs1/gtin');
      const validation = validateGTIN(gtinForStorage);
      if (!validation.valid || !validation.normalized) {
        const response = errorResponse('VALIDATION_ERROR', validation.error || 'Invalid GTIN format', 400);
        return NextResponse.json(response.payload, { status: response.status });
      }
      gtinForStorage = validation.normalized;
    }

    const { data: sku, error: skuErr } = await supabase
      .from('skus')
      .select('id')
      .eq('company_id', authCompanyId)
      .eq('sku_code', normalizedSkuCode)
      .is('deleted_at', null)
      .maybeSingle();

    if (skuErr) {
      throw skuErr;
    }

    const legacySkuId = sku?.id ?? null;
    const expiryYYMMDD = (() => {
      const dt = new Date(String(resolvedExpiry));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    })();
    const mfgYYMMDD = (() => {
      const dt = new Date(String(resolvedMfd));
      const yy = String(dt.getFullYear()).slice(-2);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    })();

    const buildPayloadForSerial = (serial: string) =>
      codeMode === 'GS1'
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

    const allocateUniqueSerial = (usedSerials: Set<string>) => {
      let serial = '';
      do {
        serial = generateUnitSerial();
      } while (usedSerials.has(serial));
      usedSerials.add(serial);
      return serial;
    };

    const createRow = (serial: string): UnitLabelRow => {
      const payload = buildPayloadForSerial(serial);
      return {
        company_id: authCompanyId,
        sku_id: legacySkuId,
        unit_sku_master_id: unit_sku_master_id.trim(),
        gtin: codeMode === 'GS1' ? gtinForStorage : null,
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

    const insertedUnitIds: string[] = [];
    let consumedQuantity = 0;

    for (let i = 0; i < rows.length; i += DB_INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + DB_INSERT_BATCH_SIZE);
      const decision = await enforceEntitlement({
        companyId: authCompanyId,
        usageType: UsageType.UNIT_LABEL,
        quantity: batch.length,
        requestId: `${IDEMPOTENCY_ENDPOINT}:${idempotency.kind === 'ok' ? idempotency.key : 'gen'}:batch:${i / DB_INSERT_BATCH_SIZE}`,
        metadata: {
          source: 'unit_create',
          unit_sku_master_id: unit_sku_master_id.trim(),
          code_mode: codeMode,
        },
      });

      if (!decision.allow) {
        if (insertedUnitIds.length > 0) {
          await supabase.from('labels_units').delete().in('id', insertedUnitIds);
        }
        if (consumedQuantity > 0) {
          await refundEntitlement({
            companyId: authCompanyId,
            usageType: UsageType.UNIT_LABEL,
            quantity: consumedQuantity,
          });
        }
        const isQuotaError = String(decision.reason_code || '').toUpperCase().includes('QUOTA_EXCEEDED');
        const response = errorResponse(
          String(decision.reason_code || 'QUOTA_EXCEEDED'),
          isQuotaError ? 'Quota exceeded. Please purchase add-ons.' : String(decision.reason_code || 'QUOTA_EXCEEDED'),
          403
        );
        return NextResponse.json(response.payload, { status: response.status });
      }
      consumedQuantity += batch.length;

      let inserted = false;
      let attempts = 0;

      while (!inserted) {
        const { data, error } = await supabase.from('labels_units').insert(batch).select('id');
        if (!error) {
          insertedUnitIds.push(...(((data as Array<{ id: string }>) || []).map((row) => row.id)));
          inserted = true;
          continue;
        }

        if (!isUniqueViolation(error)) {
          if (insertedUnitIds.length > 0) {
            await supabase.from('labels_units').delete().in('id', insertedUnitIds);
          }
          if (consumedQuantity > 0) {
            await refundEntitlement({
              companyId: authCompanyId,
              usageType: UsageType.UNIT_LABEL,
              quantity: consumedQuantity,
            });
          }
          throw error;
        }

        attempts += 1;
        if (attempts >= MAX_SERIAL_RETRY_ATTEMPTS) {
          if (insertedUnitIds.length > 0) {
            await supabase.from('labels_units').delete().in('id', insertedUnitIds);
          }
          if (consumedQuantity > 0) {
            await refundEntitlement({
              companyId: authCompanyId,
              usageType: UsageType.UNIT_LABEL,
              quantity: consumedQuantity,
            });
          }
          const response = errorResponse('CONFLICT', 'Duplicate serial detected after retries. Please try again.', 409);
          return NextResponse.json(response.payload, { status: response.status });
        }

        regenerateBatchSerials(batch);
      }
    }

    const response = successResponse({
      generated: rows.length,
      items: rows.map((row) => ({
        serial: row.serial,
        gs1: row.payload ?? row.gs1_payload,
        payload: row.payload ?? row.gs1_payload,
        code_mode: row.code_mode,
      })),
    });

    if (idempotency.kind === 'ok') {
      await maybeStoreSuccessfulReplay({
        supabase,
        userId: user.id,
        idempotencyKey: idempotency.key,
        requestHash: idempotency.requestHash,
        payload: response.payload,
        status: response.status,
      });
    }

    return NextResponse.json(response.payload, { status: response.status });
  } catch (err: any) {
    const status =
      err?.code === 'PAST_DUE' || err?.code === 'SUBSCRIPTION_INACTIVE'
        ? 402
        : 500;
    const response = errorResponse(
      err?.code === 'PAST_DUE' || err?.code === 'SUBSCRIPTION_INACTIVE' ? String(err.code) : 'INTERNAL_ERROR',
      err?.message || 'Unit generation failed',
      status
    );
    return NextResponse.json(response.payload, { status: response.status });
  }
}

import { apiJson } from '@/lib/api/response';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit';
import { generateCanonicalGS1 } from '@/lib/gs1Canonical';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { resolveExactUnitSkuMasterId, resolveLegacySkuIdForCode } from '@/lib/unitSkuMasterLink';
import {
  beginErpImportSession,
  completeErpImportSession,
  computeErpImportRequestHash,
  ErpImportIdempotencyError,
} from '@/lib/erp/importSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportResults = {
  total: number;
  imported: number;
  skipped: number;
  duplicates: number;
  invalid: number;
  errors: Array<{ row: number; error: string }>;
};

type UnitInsertRow = {
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string | null;
  gtin: string | null;
  batch: string;
  mfd: string | null;
  expiry: string;
  mrp: string | null;
  serial: string;
  gs1_payload: string;
  code_mode: 'GS1';
  payload: string;
};

async function resolveAuthCompany() {
  const supabase = await supabaseServer();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: apiJson({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = getSupabaseAdmin();
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('id, company_name')
    .eq('user_id', user.id)
    .single();

  if (companyError || !company?.id) {
    return { error: apiJson({ error: 'Company profile not found' }, { status: 400 }) };
  }

  return { companyId: company.id, companyName: company.company_name || '', userId: user.id };
}

function isUniqueViolation(error: any) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('unique');
}

async function insertUnitBatchWithFallback(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  batch: UnitInsertRow[];
  results: ImportResults;
}) {
  const { admin, batch, results } = params;
  let inserted = 0;

  const { error: batchError } = await admin.from('labels_units').insert(batch);
  if (!batchError) {
    return { inserted, fatalError: null as string | null, duplicates: 0 };
  }

  if (!isUniqueViolation(batchError)) {
    return { inserted, fatalError: batchError.message || 'Failed to import units', duplicates: 0 };
  }

  let duplicates = 0;
  for (const row of batch) {
    const { error: rowError } = await admin.from('labels_units').insert(row);
    if (!rowError) {
      inserted += 1;
      continue;
    }

    if (isUniqueViolation(rowError)) {
      duplicates += 1;
      results.duplicates += 1;
      results.skipped += 1;
      continue;
    }

    return {
      inserted,
      fatalError: rowError.message || 'Failed to import unit row',
      duplicates,
    };
  }

  return { inserted, fatalError: null as string | null, duplicates };
}

export async function POST(req: Request) {
  let sessionId: string | null = null;
  let companyIdForSession: string | null = null;
  let userIdForSession: string | null = null;
  let results: ImportResults = {
    total: 0,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    invalid: 0,
    errors: [],
  };

  try {
    const auth = await resolveAuthCompany();
    if ('error' in auth) return auth.error;

    const { companyId, userId } = auth;
    companyIdForSession = companyId;
    userIdForSession = userId;
    const admin = getSupabaseAdmin();

    const { data: company } = await admin
      .from('companies')
      .select('erp_ingestion_mode')
      .eq('id', companyId)
      .maybeSingle();

    const ingestionMode = company?.erp_ingestion_mode;
    if (ingestionMode !== 'unit' && ingestionMode !== 'both') {
      return apiJson(
        {
          error: 'Unit-level ERP ingestion is not enabled for your company. Please enable it in ERP Integration settings.',
          code: 'ingestion_mode_disabled',
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    results.total = rows.length;

    if (rows.length === 0) {
      return apiJson(
        { error: 'No rows provided. CSV must contain unit code data.' },
        { status: 400 }
      );
    }

    if (rows.length > 10000) {
      return apiJson(
        { error: 'Too many rows. Maximum 10,000 rows per import.' },
        { status: 400 }
      );
    }

    const requestId =
      req.headers.get('Idempotency-Key') ||
      req.headers.get('Idempotency-key') ||
      req.headers.get('idempotency-key') ||
      crypto.randomUUID();

    const session = await beginErpImportSession({
      supabase: admin,
      companyId,
      actor: userId,
      importType: 'unit',
      idempotencyKey: requestId,
      requestHash: computeErpImportRequestHash(rows),
      totalRows: rows.length,
    });

    if (session.mode === 'replay') {
      return apiJson(session.result, { status: session.responseStatus });
    }

    if (session.mode === 'in_progress') {
      return apiJson(
        {
          error: 'An ERP unit import with this idempotency key is already processing.',
          code: 'import_in_progress',
        },
        { status: 409 }
      );
    }

    sessionId = session.sessionId;

    const auditIssues: Array<Record<string, any>> = [];
    const seenSerialKeys = new Set<string>();
    const validRows: UnitInsertRow[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNum = idx + 1;

      try {
        const skuCode = String(row.sku_code || row.SKU_CODE || '').trim().toUpperCase();
        const batch = String(row.batch || row.BATCH || row.batch_number || '').trim();
        const expiryDate = String(row.expiry_date || row.EXPIRY_DATE || row.exp || '').trim();
        const serialNumber = String(row.serial_number || row.SERIAL_NUMBER || row.serial || '').trim();
        const gtin = String(row.gtin || row.GTIN || '').trim() || null;
        const mrp = row.mrp || row.MRP ? String(row.mrp || row.MRP).trim() : null;
        const mfd = row.mfd || row.MFD || row.mfg_date ? String(row.mfd || row.MFD || row.mfg_date).trim() : null;

        if (!skuCode) {
          results.errors.push({ row: rowNum, error: 'SKU Code is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'SKU Code is required' });
          results.invalid++;
          continue;
        }

        if (!batch) {
          results.errors.push({ row: rowNum, error: 'Batch Number is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'Batch Number is required', sku_code: skuCode });
          results.invalid++;
          continue;
        }

        if (!expiryDate) {
          results.errors.push({ row: rowNum, error: 'Expiry Date is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'Expiry Date is required', sku_code: skuCode, batch });
          results.invalid++;
          continue;
        }

        if (!serialNumber) {
          results.errors.push({ row: rowNum, error: 'Serial Number is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'Serial Number is required', sku_code: skuCode, batch, gtin });
          results.invalid++;
          continue;
        }

        const skuId = await resolveLegacySkuIdForCode(admin, companyId, skuCode);

        if (!gtin) {
          results.errors.push({
            row: rowNum,
            error: 'GTIN is required. ERP unit ingestion only accepts valid GS1/GTIN-based codes.',
          });
          auditIssues.push({
            row: rowNum,
            category: 'invalid',
            reason: 'GTIN is required. ERP unit ingestion only accepts valid GS1/GTIN-based codes.',
            sku_code: skuCode,
            batch,
            serial_number: serialNumber,
          });
          results.invalid++;
          continue;
        }

        const { validateGTIN } = await import('@/lib/gs1/gtin');
        const validation = validateGTIN(gtin);
        if (!validation.valid) {
          results.errors.push({ row: rowNum, error: validation.error || 'Invalid GTIN format' });
          auditIssues.push({
            row: rowNum,
            category: 'invalid',
            reason: validation.error || 'Invalid GTIN format',
            sku_code: skuCode,
            batch,
            serial_number: serialNumber,
            gtin,
          });
          results.invalid++;
          continue;
        }
        const finalGtin = validation.normalized!;

        const serialKey = `${companyId}::${finalGtin}::${serialNumber}`;
        if (seenSerialKeys.has(serialKey)) {
          results.duplicates++;
          results.skipped++;
          auditIssues.push({
            row: rowNum,
            category: 'duplicate',
            reason: 'Duplicate GTIN + serial in uploaded file',
            sku_code: skuCode,
            batch,
            serial_number: serialNumber,
            gtin: finalGtin,
          });
          continue;
        }
        seenSerialKeys.add(serialKey);

        const { data: existing } = await admin
          .from('labels_units')
          .select('id')
          .eq('company_id', companyId)
          .eq('gtin', finalGtin)
          .eq('serial', serialNumber)
          .maybeSingle();

        if (existing?.id) {
          results.duplicates++;
          results.skipped++;
          auditIssues.push({
            row: rowNum,
            category: 'duplicate',
            reason: 'GTIN + serial already exists for this company',
            sku_code: skuCode,
            batch,
            serial_number: serialNumber,
            gtin: finalGtin,
          });
          continue;
        }

        let normalizedExpiry = expiryDate;
        if (/^\d{6}$/.test(expiryDate)) {
          const yy = expiryDate.slice(0, 2);
          const mm = expiryDate.slice(2, 4);
          const dd = expiryDate.slice(4, 6);
          normalizedExpiry = `20${yy}-${mm}-${dd}`;
        }

        let normalizedMfd: string | null = null;
        if (mfd) {
          if (/^\d{6}$/.test(mfd)) {
            const yy = mfd.slice(0, 2);
            const mm = mfd.slice(2, 4);
            const dd = mfd.slice(4, 6);
            normalizedMfd = `20${yy}-${mm}-${dd}`;
          } else {
            normalizedMfd = mfd;
          }
        }

        let payload: string;
        try {
          payload = generateCanonicalGS1({
            gtin: finalGtin,
            expiry: normalizedExpiry,
            batch,
            serial: serialNumber,
          });
        } catch (e: any) {
          results.errors.push({ row: rowNum, error: `Payload generation failed: ${e.message}` });
          auditIssues.push({
            row: rowNum,
            category: 'invalid',
            reason: `Payload generation failed: ${e.message}`,
            sku_code: skuCode,
            batch,
            serial_number: serialNumber,
            gtin: finalGtin,
          });
          results.invalid++;
          continue;
        }

        const unitSkuMasterId = await resolveExactUnitSkuMasterId({
          supabase: admin,
          companyId,
          skuCode,
          batch,
          expiry: normalizedExpiry,
          mfd: normalizedMfd,
          mrp,
        });

        validRows.push({
          company_id: companyId,
          sku_id: skuId,
          unit_sku_master_id: unitSkuMasterId,
          gtin: finalGtin,
          batch,
          mfd: normalizedMfd || new Date().toISOString().split('T')[0],
          expiry: normalizedExpiry,
          mrp,
          serial: serialNumber,
          gs1_payload: payload,
          code_mode: 'GS1',
          payload,
        });
      } catch (rowError: any) {
        results.errors.push({ row: rowNum, error: rowError.message || 'Row processing failed' });
        auditIssues.push({ row: rowNum, category: 'invalid', reason: rowError.message || 'Row processing failed' });
        results.invalid++;
      }
    }

    if (validRows.length > 0) {
      const BATCH_SIZE = 1000;

      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        const decision = await enforceEntitlement({
          companyId,
          usageType: UsageType.UNIT_LABEL,
          quantity: batch.length,
          requestId: `erp:unit_ingest:${sessionId}:batch:${i / BATCH_SIZE}`,
          metadata: { source: 'erp_unit_ingest', session_id: sessionId },
        });

        if (!decision.allow) {
          const payload = {
            error: String(decision.reason_code || '').toUpperCase().includes('QUOTA_EXCEEDED')
              ? 'Quota exceeded. Please purchase add-ons.'
              : decision.reason_code || 'QUOTA_EXCEEDED',
            code: decision.reason_code || 'QUOTA_EXCEEDED',
            results,
          };

          await completeErpImportSession({
            supabase: admin,
            sessionId,
            status: 'failed',
            responseStatus: 403,
            result: payload,
            errorMessage: payload.error,
            summary: {
              validated: validRows.length,
              imported: results.imported,
              duplicates: results.duplicates,
              skipped: results.skipped,
              invalid: results.invalid,
            },
          });

          return apiJson(payload, { status: 403 });
        }

        const { inserted, fatalError } = await insertUnitBatchWithFallback({
          admin,
          batch,
          results,
        });

        const refundQty = batch.length - inserted;
        if (refundQty > 0) {
          await refundEntitlement({
            companyId,
            usageType: UsageType.UNIT_LABEL,
            quantity: refundQty,
          });
        }

        results.imported += inserted;

        if (fatalError) {
          const payload = {
            error: `Failed to import units: ${fatalError}`,
            results,
          };

          await completeErpImportSession({
            supabase: admin,
            sessionId,
            status: 'failed',
            responseStatus: 500,
            result: payload,
            errorMessage: payload.error,
            summary: {
              validated: validRows.length,
              imported: results.imported,
              duplicates: results.duplicates,
              skipped: results.skipped,
              invalid: results.invalid,
            },
          });

          return apiJson(payload, { status: 500 });
        }
      }
    }

    const responsePayload = {
      success: true,
      message: `Imported ${results.imported} unit codes. ${results.duplicates} duplicates skipped. ${results.invalid} invalid rows.`,
      results,
    };

    await completeErpImportSession({
      supabase: admin,
      sessionId,
      status: 'completed',
      responseStatus: 200,
      result: responsePayload,
      summary: {
        validated: validRows.length,
        imported: results.imported,
        duplicates: results.duplicates,
        skipped: results.skipped,
        invalid: results.invalid,
      },
    });

    try {
      await writeAuditLog({
        companyId,
        actor: userId,
        action: 'ERP_UNIT_INGEST',
        status: results.invalid === 0 && results.errors.length === 0 ? 'success' : 'failed',
        integrationSystem: 'ERP',
        metadata: {
          source: 'ERP',
          imported_by_user_id: userId,
          imported_at: new Date().toISOString(),
          erp_import_session_id: sessionId,
          validation_result: {
            total: results.total,
            imported: results.imported,
            skipped: results.skipped,
            duplicates: results.duplicates,
            invalid: results.invalid,
          },
          error_count: results.errors.length,
          issue_rows: auditIssues,
        },
      });
    } catch (auditError) {
      console.error('Failed to log ERP ingestion audit:', auditError);
    }

    return apiJson(responsePayload);
  } catch (err: any) {
    const admin = getSupabaseAdmin();
    if (err instanceof ErpImportIdempotencyError) {
      return apiJson(
        { error: err.message, code: 'idempotency_conflict' },
        { status: 409 }
      );
    }

    if (sessionId && companyIdForSession && userIdForSession) {
      const payload = {
        error: err?.message || 'ERP unit code ingestion failed. Please try again or contact support.',
        results,
      };

      try {
        await completeErpImportSession({
          supabase: admin,
          sessionId,
          status: 'failed',
          responseStatus: 500,
          result: payload,
          errorMessage: payload.error,
          summary: {
            validated: Math.max(0, results.total - results.invalid - results.duplicates),
            imported: results.imported,
            duplicates: results.duplicates,
            skipped: results.skipped,
            invalid: results.invalid,
          },
        });
      } catch (sessionError) {
        console.error('Failed to finalize ERP unit import session:', sessionError);
      }
    }

    console.error('ERP Unit Ingestion error:', err);
    return apiJson(
      { error: err?.message || 'ERP unit code ingestion failed. Please try again or contact support.' },
      { status: 500 }
    );
  }
}

import { apiJson } from '@/lib/api/response';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit';
import { consumeEntitlementBatch, refundEntitlementBatch, type EntitlementBatchItem } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { resolveLegacySkuIdForCode, resolveSsccUnitSkuMasterId } from '@/lib/unitSkuMasterLink';
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

type StageRow = {
  rowNum: number;
  hierarchyLevel: 'PALLET' | 'CARTON' | 'BOX';
  parentSscc: string | null;
  sscc: string;
  sku_id: string | null;
  unit_sku_master_id: string | null;
};

type PalletInsertRow = {
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string | null;
  sscc: string;
  sscc_with_ai: string;
};

type CartonInsertRow = {
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string | null;
  pallet_id: string | null;
  sscc: string;
  sscc_with_ai: string;
};

type BoxInsertRow = {
  company_id: string;
  sku_id: string | null;
  unit_sku_master_id: string | null;
  carton_id: string | null;
  sscc: string;
  sscc_with_ai: string;
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

function isValidSSCC(sscc: string): boolean {
  const cleaned = sscc.replace(/\D/g, '');
  return cleaned.length === 18 && /^\d{18}$/.test(cleaned);
}

function isUniqueViolation(error: any) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('unique');
}

async function fetchIdMapBySscc(
  admin: ReturnType<typeof getSupabaseAdmin>,
  table: 'pallets' | 'cartons' | 'boxes',
  companyId: string,
  ssccValues: string[]
) {
  const uniqueSsccs = Array.from(new Set(ssccValues.filter(Boolean)));
  if (uniqueSsccs.length === 0) return new Map<string, string>();

  const { data, error } = await admin
    .from(table)
    .select('id, sscc')
    .eq('company_id', companyId)
    .in('sscc', uniqueSsccs);

  if (error) throw error;

  return ((data as Array<{ id: string; sscc: string }>) || []).reduce((map, row) => {
    map.set(row.sscc, row.id);
    return map;
  }, new Map<string, string>());
}

async function insertRowsWithDuplicateFallback<T extends { sscc: string }>(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  table: 'pallets' | 'cartons' | 'boxes';
  rows: T[];
  results: ImportResults;
}) {
  const { admin, table, rows, results } = params;
  let inserted = 0;

  const { error: batchError } = await admin.from(table).insert(rows as any[]);
  if (!batchError) {
    return { inserted: rows.length, fatalError: null as string | null };
  }

  if (!isUniqueViolation(batchError)) {
    return { inserted, fatalError: batchError.message || `Failed to import ${table}` };
  }

  for (const row of rows) {
    const { error: rowError } = await admin.from(table).insert(row as any);
    if (!rowError) {
      inserted += 1;
      continue;
    }

    if (isUniqueViolation(rowError)) {
      results.duplicates += 1;
      results.skipped += 1;
      continue;
    }

    return { inserted, fatalError: rowError.message || `Failed to import ${table} row` };
  }

  return { inserted, fatalError: null as string | null };
}

async function consumeAndInsertLevel<T extends { sscc: string }>(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  sessionId: string;
  results: ImportResults;
  table: 'pallets' | 'cartons' | 'boxes';
  rows: T[];
  usageType: UsageType;
  requestLabel: string;
}) {
  const { admin, companyId, sessionId, results, table, rows, usageType, requestLabel } = params;
  if (rows.length === 0) {
    return { fatalError: null as string | null, inserted: 0 };
  }

  const batchItem: EntitlementBatchItem = {
    usageType,
    quantity: rows.length,
    requestId: `erp:sscc_ingest:${requestLabel}:${sessionId}`,
    metadata: { source: 'erp_sscc_ingest', level: requestLabel, session_id: sessionId },
  };

  const consumption = await consumeEntitlementBatch({
    companyId,
    items: [batchItem],
  });

  if (!consumption.ok) {
    return {
      fatalError: String(consumption.error || '').toUpperCase().includes('QUOTA_EXCEEDED')
        ? 'Quota exceeded. Please purchase add-ons.'
        : consumption.error || 'QUOTA_EXCEEDED',
      inserted: 0,
      statusCode: 403,
      code: consumption.error || 'QUOTA_EXCEEDED',
    };
  }

  const { inserted, fatalError } = await insertRowsWithDuplicateFallback({
    admin,
    table,
    rows,
    results,
  });

  const refundQty = rows.length - inserted;
  if (refundQty > 0) {
    await refundEntitlementBatch({
      companyId,
      items: [
        {
          usageType,
          quantity: refundQty,
        },
      ],
    });
  }

  results.imported += inserted;

  if (fatalError) {
    return { fatalError, inserted, statusCode: 500, code: null };
  }

  return { fatalError: null as string | null, inserted, statusCode: 200, code: null };
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
    if (ingestionMode !== 'sscc' && ingestionMode !== 'both') {
      return apiJson(
        {
          error: 'SSCC-level ERP ingestion is not enabled for your company. Please enable it in ERP Integration settings.',
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
        { error: 'No rows provided. CSV must contain SSCC code data.' },
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
      importType: 'sscc',
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
          error: 'An ERP SSCC import with this idempotency key is already processing.',
          code: 'import_in_progress',
        },
        { status: 409 }
      );
    }

    sessionId = session.sessionId;

    const auditIssues: Array<Record<string, any>> = [];
    const seenSscc = new Set<string>();
    const stagedRows: StageRow[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNum = idx + 1;

      try {
        const sscc = String(row.sscc || row.SSCC || '').trim().replace(/\D/g, '');
        const skuCode = String(row.sku_code || row.SKU_CODE || '').trim().toUpperCase();
        const batch = String(row.batch || row.BATCH || row.batch_number || '').trim();
        const hierarchyLevel = String(row.hierarchy_level || row.HIERARCHY_LEVEL || '').trim().toUpperCase() as StageRow['hierarchyLevel'];
        const parentSscc = row.parent_sscc || row.PARENT_SSCC
          ? String(row.parent_sscc || row.PARENT_SSCC).trim().replace(/\D/g, '')
          : null;

        if (!sscc) {
          results.errors.push({ row: rowNum, error: 'SSCC is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'SSCC is required' });
          results.invalid++;
          continue;
        }

        if (!isValidSSCC(sscc)) {
          results.errors.push({ row: rowNum, error: 'SSCC must be 18 digits' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'SSCC must be 18 digits', sscc });
          results.invalid++;
          continue;
        }

        if (seenSscc.has(sscc)) {
          results.duplicates += 1;
          results.skipped += 1;
          auditIssues.push({ row: rowNum, category: 'duplicate', reason: 'Duplicate SSCC in uploaded file', sscc });
          continue;
        }
        seenSscc.add(sscc);

        if (!skuCode) {
          results.errors.push({ row: rowNum, error: 'SKU Code is required' });
          auditIssues.push({ row: rowNum, category: 'invalid', reason: 'SKU Code is required', sscc });
          results.invalid++;
          continue;
        }

        if (!hierarchyLevel || !['BOX', 'CARTON', 'PALLET'].includes(hierarchyLevel)) {
          results.errors.push({ row: rowNum, error: 'Hierarchy Level must be BOX, CARTON, or PALLET' });
          auditIssues.push({
            row: rowNum,
            category: 'invalid',
            reason: 'Hierarchy Level must be BOX, CARTON, or PALLET',
            sscc,
            sku_code: skuCode,
            batch,
            hierarchy_level: hierarchyLevel || null,
          });
          results.invalid++;
          continue;
        }

        const skuId = await resolveLegacySkuIdForCode(admin, companyId, skuCode);
        const unitSkuMasterId = await resolveSsccUnitSkuMasterId({
          supabase: admin,
          companyId,
          skuCode,
          batch,
        });

        let existingCheck: any;
        if (hierarchyLevel === 'PALLET') {
          const { data } = await admin.from('pallets').select('id').eq('company_id', companyId).eq('sscc', sscc).maybeSingle();
          existingCheck = data;
        } else if (hierarchyLevel === 'CARTON') {
          const { data } = await admin.from('cartons').select('id').eq('company_id', companyId).eq('sscc', sscc).maybeSingle();
          existingCheck = data;
        } else {
          const { data } = await admin.from('boxes').select('id').eq('company_id', companyId).eq('sscc', sscc).maybeSingle();
          existingCheck = data;
        }

        if (existingCheck?.id) {
          results.duplicates += 1;
          results.skipped += 1;
          auditIssues.push({
            row: rowNum,
            category: 'duplicate',
            reason: `SSCC already exists for ${hierarchyLevel}`,
            sscc,
            sku_code: skuCode,
            batch,
            hierarchy_level: hierarchyLevel,
            parent_sscc: parentSscc,
          });
          continue;
        }

        stagedRows.push({
          rowNum,
          hierarchyLevel,
          parentSscc,
          sscc,
          sku_id: skuId,
          unit_sku_master_id: unitSkuMasterId,
        });
      } catch (rowError: any) {
        results.errors.push({ row: rowNum, error: rowError.message || 'Row processing failed' });
        auditIssues.push({ row: rowNum, category: 'invalid', reason: rowError.message || 'Row processing failed' });
        results.invalid++;
      }
    }

    const palletRows: PalletInsertRow[] = stagedRows
      .filter((row) => row.hierarchyLevel === 'PALLET')
      .map((row) => ({
        company_id: companyId,
        sku_id: row.sku_id,
        unit_sku_master_id: row.unit_sku_master_id,
        sscc: row.sscc,
        sscc_with_ai: `(00)${row.sscc}`,
      }));

    const palletInsert = await consumeAndInsertLevel({
      admin,
      companyId,
      sessionId,
      results,
      table: 'pallets',
      rows: palletRows,
      usageType: UsageType.PALLET_LABEL,
      requestLabel: 'pallet',
    });

    if (palletInsert.fatalError) {
      const payload = {
        error: palletInsert.fatalError,
        code: palletInsert.code,
        results,
      };

      await completeErpImportSession({
        supabase: admin,
        sessionId,
        status: 'failed',
        responseStatus: palletInsert.statusCode || 500,
        result: payload,
        errorMessage: payload.error,
        summary: {
          validated: stagedRows.length,
          imported: results.imported,
          duplicates: results.duplicates,
          skipped: results.skipped,
          invalid: results.invalid,
        },
      });

      return apiJson(payload, { status: palletInsert.statusCode || 500 });
    }

    const palletIdBySscc = await fetchIdMapBySscc(
      admin,
      'pallets',
      companyId,
      stagedRows.filter((row) => row.hierarchyLevel === 'PALLET' || row.hierarchyLevel === 'CARTON').map((row) => row.hierarchyLevel === 'CARTON' ? row.parentSscc || '' : row.sscc)
    );

    const cartonRows: CartonInsertRow[] = [];
    for (const row of stagedRows.filter((item) => item.hierarchyLevel === 'CARTON')) {
      const parentId = row.parentSscc ? palletIdBySscc.get(row.parentSscc) ?? null : null;
      if (row.parentSscc && !parentId) {
        results.errors.push({ row: row.rowNum, error: `Parent pallet SSCC not found: ${row.parentSscc}` });
        auditIssues.push({
          row: row.rowNum,
          category: 'invalid',
          reason: `Parent pallet SSCC not found: ${row.parentSscc}`,
          sscc: row.sscc,
          hierarchy_level: row.hierarchyLevel,
          parent_sscc: row.parentSscc,
        });
        results.invalid++;
        continue;
      }

      cartonRows.push({
        company_id: companyId,
        sku_id: row.sku_id,
        unit_sku_master_id: row.unit_sku_master_id,
        pallet_id: parentId,
        sscc: row.sscc,
        sscc_with_ai: `(00)${row.sscc}`,
      });
    }

    const cartonInsert = await consumeAndInsertLevel({
      admin,
      companyId,
      sessionId,
      results,
      table: 'cartons',
      rows: cartonRows,
      usageType: UsageType.CARTON_LABEL,
      requestLabel: 'carton',
    });

    if (cartonInsert.fatalError) {
      const payload = {
        error: cartonInsert.fatalError,
        code: cartonInsert.code,
        results,
      };

      await completeErpImportSession({
        supabase: admin,
        sessionId,
        status: 'failed',
        responseStatus: cartonInsert.statusCode || 500,
        result: payload,
        errorMessage: payload.error,
        summary: {
          validated: stagedRows.length,
          imported: results.imported,
          duplicates: results.duplicates,
          skipped: results.skipped,
          invalid: results.invalid,
        },
      });

      return apiJson(payload, { status: cartonInsert.statusCode || 500 });
    }

    const cartonIdBySscc = await fetchIdMapBySscc(
      admin,
      'cartons',
      companyId,
      stagedRows.filter((row) => row.hierarchyLevel === 'CARTON' || row.hierarchyLevel === 'BOX').map((row) => row.hierarchyLevel === 'BOX' ? row.parentSscc || '' : row.sscc)
    );

    const boxRows: BoxInsertRow[] = [];
    for (const row of stagedRows.filter((item) => item.hierarchyLevel === 'BOX')) {
      const parentId = row.parentSscc ? cartonIdBySscc.get(row.parentSscc) ?? null : null;
      if (row.parentSscc && !parentId) {
        results.errors.push({ row: row.rowNum, error: `Parent carton SSCC not found: ${row.parentSscc}` });
        auditIssues.push({
          row: row.rowNum,
          category: 'invalid',
          reason: `Parent carton SSCC not found: ${row.parentSscc}`,
          sscc: row.sscc,
          hierarchy_level: row.hierarchyLevel,
          parent_sscc: row.parentSscc,
        });
        results.invalid++;
        continue;
      }

      boxRows.push({
        company_id: companyId,
        sku_id: row.sku_id,
        unit_sku_master_id: row.unit_sku_master_id,
        carton_id: parentId,
        sscc: row.sscc,
        sscc_with_ai: `(00)${row.sscc}`,
      });
    }

    const boxInsert = await consumeAndInsertLevel({
      admin,
      companyId,
      sessionId,
      results,
      table: 'boxes',
      rows: boxRows,
      usageType: UsageType.BOX_LABEL,
      requestLabel: 'box',
    });

    if (boxInsert.fatalError) {
      const payload = {
        error: boxInsert.fatalError,
        code: boxInsert.code,
        results,
      };

      await completeErpImportSession({
        supabase: admin,
        sessionId,
        status: 'failed',
        responseStatus: boxInsert.statusCode || 500,
        result: payload,
        errorMessage: payload.error,
        summary: {
          validated: stagedRows.length,
          imported: results.imported,
          duplicates: results.duplicates,
          skipped: results.skipped,
          invalid: results.invalid,
        },
      });

      return apiJson(payload, { status: boxInsert.statusCode || 500 });
    }

    const responsePayload = {
      success: true,
      message: `Imported ${results.imported} SSCC codes. ${results.duplicates} duplicates skipped. ${results.invalid} invalid rows.`,
      results,
    };

    await completeErpImportSession({
      supabase: admin,
      sessionId,
      status: 'completed',
      responseStatus: 200,
      result: responsePayload,
      summary: {
        validated: stagedRows.length,
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
        action: 'ERP_SSCC_INGEST',
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
      console.error('Failed to log ERP SSCC ingestion audit:', auditError);
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
        error: err?.message || 'ERP SSCC code ingestion failed. Please try again or contact support.',
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
        console.error('Failed to finalize ERP SSCC import session:', sessionError);
      }
    }

    console.error('ERP SSCC Ingestion error:', err);
    return apiJson(
      { error: err?.message || 'ERP SSCC code ingestion failed. Please try again or contact support.' },
      { status: 500 }
    );
  }
}

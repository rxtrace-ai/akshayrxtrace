import { NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit';
import { generateCanonicalGS1 } from '@/lib/gs1Canonical';
import { resolveCodeMode } from '@/lib/codeMode';
import { buildPicUnitPayload } from '@/lib/picPayload';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { resolveExactUnitSkuMasterId, resolveLegacySkuIdForCode } from '@/lib/unitSkuMasterLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolve company_id from authenticated user
async function resolveAuthCompany() {
  const supabase = await supabaseServer();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

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

export async function POST(req: Request) {
  try {
    const auth = await resolveAuthCompany();
    if ('error' in auth) return auth.error;

    const { companyId, companyName, userId } = auth;
    const admin = getSupabaseAdmin();

    // Check ERP ingestion mode - unit ingestion allowed only if mode = unit | both
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

    const results = {
      total: rows.length,
      imported: 0,
      skipped: 0,
      duplicates: 0,
      invalid: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    const requestId =
      req.headers.get('Idempotency-Key') ||
      req.headers.get('Idempotency-key') ||
      req.headers.get('idempotency-key') ||
      crypto.randomUUID();

    const validRows: Array<{
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
      code_mode: 'GS1' | 'PIC';
      payload: string;
    }> = [];

    // Process each row
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNum = idx + 1;

      try {
        // Required fields
        const skuCode = String(row.sku_code || row.SKU_CODE || '').trim().toUpperCase();
        const batch = String(row.batch || row.BATCH || row.batch_number || '').trim();
        const expiryDate = String(row.expiry_date || row.EXPIRY_DATE || row.exp || '').trim();
        const serialNumber = String(row.serial_number || row.SERIAL_NUMBER || row.serial || '').trim();
        const gtin = String(row.gtin || row.GTIN || '').trim() || null;
        const mrp = row.mrp || row.MRP ? String(row.mrp || row.MRP).trim() : null;
        const mfd = row.mfd || row.MFD || row.mfg_date ? String(row.mfd || row.MFD || row.mfg_date).trim() : null;

        // Validate required fields
        if (!skuCode) {
          results.errors.push({ row: rowNum, error: 'SKU Code is required' });
          results.invalid++;
          continue;
        }

        if (!batch) {
          results.errors.push({ row: rowNum, error: 'Batch Number is required' });
          results.invalid++;
          continue;
        }

        if (!expiryDate) {
          results.errors.push({ row: rowNum, error: 'Expiry Date is required' });
          results.invalid++;
          continue;
        }

        if (!serialNumber) {
          results.errors.push({ row: rowNum, error: 'Serial Number is required' });
          results.invalid++;
          continue;
        }

        const skuId = await resolveLegacySkuIdForCode(admin, companyId, skuCode);

        // Determine mode + normalize/validate GTIN if provided
        const codeMode = resolveCodeMode({ gtin });
        let finalGtin: string | null = null;
        if (codeMode === 'GS1') {
          const { validateGTIN } = await import('@/lib/gs1/gtin');
          const validation = validateGTIN(gtin!);
          if (!validation.valid) {
            results.errors.push({ row: rowNum, error: validation.error || 'Invalid GTIN format' });
            results.invalid++;
            continue;
          }
          finalGtin = validation.normalized!;
        }

        // Check for duplicate serial (same company, GTIN, serial)
        if (finalGtin) {
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
            continue;
          }
        }

        // Generate payload (GS1 or PIC)
        let payload: string;

        // Normalize expiry date format (expect YYYY-MM-DD or YYMMDD)
        let normalizedExpiry = expiryDate;
        if (/^\d{6}$/.test(expiryDate)) {
          // YYMMDD -> YYYY-MM-DD
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

        try {
          payload =
            codeMode === 'GS1'
              ? generateCanonicalGS1({
                  gtin: finalGtin!,
                  expiry: normalizedExpiry,
                  batch,
                  serial: serialNumber,
                })
              : buildPicUnitPayload({
                  sku: skuCode,
                  batch,
                  expiryYYMMDD: normalizedExpiry.replace(/-/g, '').slice(2), // YYYYMMDD -> YYMMDD
                  mfgYYMMDD: normalizedMfd ? normalizedMfd.replace(/-/g, '').slice(2) : undefined,
                  serial: serialNumber,
                  mrp: mrp || undefined,
                });
        } catch (e: any) {
          results.errors.push({ row: rowNum, error: `Payload generation failed: ${e.message}` });
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
          code_mode: codeMode,
          payload,
        });
      } catch (rowError: any) {
        results.errors.push({ row: rowNum, error: rowError.message || 'Row processing failed' });
        results.invalid++;
      }
    }

    // Enforce unit quota for ERP ingestion (one row = one UNIT consumption)
    if (validRows.length > 0) {
      const decision = await enforceEntitlement({
        companyId,
        usageType: UsageType.UNIT_LABEL,
        quantity: validRows.length,
        requestId: `erp:unit_ingest:${requestId}`,
        metadata: { source: 'erp_unit_ingest' },
      });

      if (!decision.allow) {
        const isQuotaError = String(decision.reason_code || "").toUpperCase().includes("QUOTA_EXCEEDED");
        return apiJson(
          {
            error: isQuotaError ? "Quota exceeded. Please purchase add-ons." : decision.reason_code || "QUOTA_EXCEEDED",
            code: decision.reason_code || 'QUOTA_EXCEEDED',
            results,
          },
          { status: 403 }
        );
      }
    }

    // Insert valid rows (batched)
    if (validRows.length > 0) {
      const BATCH_SIZE = 1000;
      let insertedCount = 0;

      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await admin.from('labels_units').insert(batch);

        if (insertError) {
          // Refund quota if we already consumed it and insert failed.
          try {
            await refundEntitlement({
              companyId,
              usageType: UsageType.UNIT_LABEL,
              quantity: validRows.length,
            });
          } catch {
            // best-effort; do not mask primary error
          }

          // Check if it's a duplicate key error
          if (insertError.code === '23505' || insertError.message?.includes('unique')) {
            results.duplicates += batch.length;
            results.skipped += batch.length;
            continue;
          }

          return apiJson(
            { error: `Failed to import units: ${insertError.message}`, results },
            { status: 500 }
          );
        }

        insertedCount += batch.length;
      }

      results.imported = insertedCount;
    }

    // Audit log
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
          validation_result: {
            total: results.total,
            imported: results.imported,
            skipped: results.skipped,
            duplicates: results.duplicates,
            invalid: results.invalid,
          },
          error_count: results.errors.length,
        },
      });
    } catch (auditError) {
      console.error('Failed to log ERP ingestion audit:', auditError);
      // Continue - ingestion succeeded, audit failure is logged
    }

    return apiJson({
      success: true,
      message: `Imported ${results.imported} unit codes. ${results.duplicates} duplicates skipped. ${results.invalid} invalid rows.`,
      results,
    });
  } catch (err: any) {
    console.error('ERP Unit Ingestion error:', err);
    return apiJson(
      { error: err?.message || 'ERP unit code ingestion failed. Please try again or contact support.' },
      { status: 500 }
    );
  }
}


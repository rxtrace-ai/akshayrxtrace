import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resolve company_id from authenticated user
async function resolveAuthCompany() {
  const supabase = await supabaseServer();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = getSupabaseAdmin();
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('id, company_name')
    .eq('user_id', user.id)
    .single();

  if (companyError || !company?.id) {
    return { error: NextResponse.json({ error: 'Company profile not found' }, { status: 400 }) };
  }

  return { companyId: company.id, companyName: company.company_name || '', userId: user.id };
}

// Validate SSCC format (18 digits)
function isValidSSCC(sscc: string): boolean {
  const cleaned = sscc.replace(/\D/g, '');
  return cleaned.length === 18 && /^\d{18}$/.test(cleaned);
}

export async function POST(req: Request) {
  try {
    const auth = await resolveAuthCompany();
    if ('error' in auth) return auth.error;

    const { companyId, companyName, userId } = auth;
    const admin = getSupabaseAdmin();

    // Check ERP ingestion mode - SSCC ingestion allowed only if mode = sscc | both
    const { data: company } = await admin
      .from('companies')
      .select('erp_ingestion_mode')
      .eq('id', companyId)
      .maybeSingle();

    const ingestionMode = company?.erp_ingestion_mode;
    if (ingestionMode !== 'sscc' && ingestionMode !== 'both') {
      return NextResponse.json(
        {
          error: 'SSCC-level ERP ingestion is not enabled for your company. Please enable it in ERP Integration settings.',
          code: 'ingestion_mode_disabled',
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No rows provided. CSV must contain SSCC code data.' },
        { status: 400 }
      );
    }

    if (rows.length > 10000) {
      return NextResponse.json(
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

    const palletsToInsert: Array<{
      company_id: string;
      sku_id: string;
      sscc: string;
      sscc_with_ai: string;
    }> = [];

    const cartonsToInsert: Array<{
      company_id: string;
      sku_id: string;
      pallet_id: string | null;
      sscc: string;
      sscc_with_ai: string;
    }> = [];

    const boxesToInsert: Array<{
      company_id: string;
      sku_id: string;
      carton_id: string | null;
      sscc: string;
      sscc_with_ai: string;
    }> = [];

    // Process each row
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNum = idx + 1;

      try {
        // Required fields
        const sscc = String(row.sscc || row.SSCC || '').trim().replace(/\D/g, '');
        const skuCode = String(row.sku_code || row.SKU_CODE || '').trim().toUpperCase();
        const batch = String(row.batch || row.BATCH || row.batch_number || '').trim();
        const hierarchyLevel = String(row.hierarchy_level || row.HIERARCHY_LEVEL || '').trim().toUpperCase();
        const parentSscc = row.parent_sscc || row.PARENT_SSCC ? String(row.parent_sscc || row.PARENT_SSCC).trim().replace(/\D/g, '') : null;

        // Validate required fields
        if (!sscc) {
          results.errors.push({ row: rowNum, error: 'SSCC is required' });
          results.invalid++;
          continue;
        }

        if (!isValidSSCC(sscc)) {
          results.errors.push({ row: rowNum, error: 'SSCC must be 18 digits' });
          results.invalid++;
          continue;
        }

        if (!skuCode) {
          results.errors.push({ row: rowNum, error: 'SKU Code is required' });
          results.invalid++;
          continue;
        }

        if (!hierarchyLevel || !['BOX', 'CARTON', 'PALLET'].includes(hierarchyLevel)) {
          results.errors.push({ row: rowNum, error: 'Hierarchy Level must be BOX, CARTON, or PALLET' });
          results.invalid++;
          continue;
        }

        // Resolve SKU ID
        let skuId: string;
        const { data: sku } = await admin
          .from('skus')
          .select('id')
          .eq('company_id', companyId)
          .eq('sku_code', skuCode)
          .maybeSingle();

        if (sku?.id) {
          skuId = sku.id;
        } else {
          // Auto-create SKU if not exists
          const { data: newSku, error: createErr } = await admin
            .from('skus')
            .upsert(
              { company_id: companyId, sku_code: skuCode, sku_name: skuCode, deleted_at: null },
              { onConflict: 'company_id,sku_code' }
            )
            .select('id')
            .single();

          if (createErr || !newSku?.id) {
            results.errors.push({ row: rowNum, error: `Failed to create/find SKU: ${skuCode}` });
            results.invalid++;
            continue;
          }

          skuId = newSku.id;
        }

        // Check for duplicate SSCC
        let existingCheck: any;
        if (hierarchyLevel === 'PALLET') {
          const { data } = await admin
            .from('pallets')
            .select('id')
            .eq('company_id', companyId)
            .eq('sscc', sscc)
            .maybeSingle();
          existingCheck = data;
        } else if (hierarchyLevel === 'CARTON') {
          const { data } = await admin
            .from('cartons')
            .select('id')
            .eq('company_id', companyId)
            .eq('sscc', sscc)
            .maybeSingle();
          existingCheck = data;
        } else if (hierarchyLevel === 'BOX') {
          const { data } = await admin
            .from('boxes')
            .select('id')
            .eq('company_id', companyId)
            .eq('sscc', sscc)
            .maybeSingle();
          existingCheck = data;
        }

        if (existingCheck?.id) {
          results.duplicates++;
          results.skipped++;
          continue;
        }

        // Resolve parent SSCC ID if provided
        let parentId: string | null = null;
        if (parentSscc && hierarchyLevel !== 'PALLET') {
          // Parent must be at higher level (PALLET > CARTON > BOX)
          let parentTable: 'pallets' | 'cartons' | 'boxes' = 'pallets';
          if (hierarchyLevel === 'BOX') {
            parentTable = 'cartons'; // Box parent is Carton
          } else if (hierarchyLevel === 'CARTON') {
            parentTable = 'pallets'; // Carton parent is Pallet
          }

          const { data: parent } = await admin
            .from(parentTable)
            .select('id')
            .eq('company_id', companyId)
            .eq('sscc', parentSscc)
            .maybeSingle();

          if (parent?.id) {
            parentId = parent.id;
          } else {
            results.errors.push({ row: rowNum, error: `Parent SSCC not found: ${parentSscc}` });
            results.invalid++;
            continue;
          }
        }

        // Insert based on hierarchy level
        const ssccWithAI = `(00)${sscc}`;

        if (hierarchyLevel === 'PALLET') {
          palletsToInsert.push({
            company_id: companyId,
            sku_id: skuId,
            sscc,
            sscc_with_ai: ssccWithAI,
          });
        } else if (hierarchyLevel === 'CARTON') {
          cartonsToInsert.push({
            company_id: companyId,
            sku_id: skuId,
            pallet_id: parentId,
            sscc,
            sscc_with_ai: ssccWithAI,
          });
        } else if (hierarchyLevel === 'BOX') {
          boxesToInsert.push({
            company_id: companyId,
            sku_id: skuId,
            carton_id: parentId,
            sscc,
            sscc_with_ai: ssccWithAI,
          });
        }
      } catch (rowError: any) {
        results.errors.push({ row: rowNum, error: rowError.message || 'Row processing failed' });
        results.invalid++;
      }
    }

    const totalToInsert = palletsToInsert.length + cartonsToInsert.length + boxesToInsert.length;

    // Enforce SSCC quota for ERP ingestion (one SSCC code = one SSCC consumption)
    if (totalToInsert > 0) {
      const decision = await enforceEntitlement({
        supabase: admin,
        companyId,
        metric: 'pallet',
        qty: totalToInsert,
        requestId: `erp:sscc_ingest:${requestId}`,
        source: 'api',
      });

      if (!decision.ok) {
        return NextResponse.json(
          { error: 'QUOTA_EXCEEDED', code: 'quota_exceeded', results },
          { status: 403 }
        );
      }

      const BATCH_SIZE = 1000;
      try {
        for (let i = 0; i < palletsToInsert.length; i += BATCH_SIZE) {
          const batch = palletsToInsert.slice(i, i + BATCH_SIZE);
          const { error } = await admin.from('pallets').insert(batch);
          if (error) throw error;
          results.imported += batch.length;
        }

        for (let i = 0; i < cartonsToInsert.length; i += BATCH_SIZE) {
          const batch = cartonsToInsert.slice(i, i + BATCH_SIZE);
          const { error } = await admin.from('cartons').insert(batch);
          if (error) throw error;
          results.imported += batch.length;
        }

        for (let i = 0; i < boxesToInsert.length; i += BATCH_SIZE) {
          const batch = boxesToInsert.slice(i, i + BATCH_SIZE);
          const { error } = await admin.from('boxes').insert(batch);
          if (error) throw error;
          results.imported += batch.length;
        }
      } catch (insertError: any) {
        try {
          await refundEntitlement({
            supabase: admin,
            companyId,
            metric: 'pallet',
            qty: totalToInsert,
            requestId: `erp:sscc_ingest:${requestId}`,
            source: 'api',
          });
        } catch {
          // best-effort
        }

        return NextResponse.json(
          { error: `Failed to import SSCCs: ${insertError?.message || String(insertError)}`, results },
          { status: 500 }
        );
      }
    }

    // Audit log
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
      console.error('Failed to log ERP SSCC ingestion audit:', auditError);
      // Continue - ingestion succeeded, audit failure is logged
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${results.imported} SSCC codes. ${results.duplicates} duplicates skipped. ${results.invalid} invalid rows.`,
      results,
    });
  } catch (err: any) {
    console.error('ERP SSCC Ingestion error:', err);
    return NextResponse.json(
      { error: err?.message || 'ERP SSCC code ingestion failed. Please try again or contact support.' },
      { status: 500 }
    );
  }
}

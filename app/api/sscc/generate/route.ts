import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyIdFromRequest } from '@/lib/company/resolve';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import { getRequestIdFromRequest } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_CODES_PER_REQUEST = 10000;
const MAX_CODES_PER_ROW = 1000;

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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

  if (!skuRow?.id) {
    const { data: created, error: createErr } = await supabase
      .from('skus')
      .upsert(
        { company_id: companyId, sku_code: skuCode, sku_name: null, deleted_at: null },
        { onConflict: 'company_id,sku_code' }
      )
      .select('id')
      .single();

    if (createErr || !created?.id) {
      throw new Error(createErr?.message ?? `Failed to create SKU in master: ${skuCode}`);
    }

    return created.id;
  }

  return skuRow.id;
}

/**
 * Unified SSCC Generation Endpoint
 * 
 * Enforces hierarchy: Box → Carton → Pallet
 * All levels consume same SSCC quota
 * 
 * Request body:
 * - sku_id: string (required)
 * - company_id: string (required)
 * - batch: string (required)
 * - expiry_date: string (required)
 * - units_per_box: number (required)
 * - boxes_per_carton: number (required if generate_carton or generate_pallet)
 * - cartons_per_pallet: number (required if generate_pallet)
 * - number_of_pallets: number (required)
 * - generate_box: boolean
 * - generate_carton: boolean
 * - generate_pallet: boolean
 */
export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  let entitlementConsumed = false;
  let consumedQuantity = 0;
  let consumedCompanyId = '';
  
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const requestId =
      typeof (body as any)?.request_id === 'string' && String((body as any).request_id).trim()
        ? `sscc_generate:body:${String((body as any).request_id).trim()}`
        : getRequestIdFromRequest(req, 'sscc_generate');

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
    } = body ?? {};
    const authCompanyId = await resolveCompanyIdFromRequest(req);
    if (!authCompanyId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (requestedCompanyId && requestedCompanyId !== authCompanyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const company_id = authCompanyId;

    if (compliance_ack !== true) {
      return NextResponse.json(
        { error: 'compliance_ack=true is required', code: 'compliance_required' },
        { status: 400 }
      );
    }

    // Option A eligibility (Phase 3+): SSCC allowed only if company has at least one SKU with a GTIN.
    const { data: anySku } = await supabase
      .from('skus')
      .select('id')
      .eq('company_id', company_id)
      .not('gtin', 'is', null)
      .limit(1);

    const hasGs1LikeGtin = Array.isArray(anySku) && anySku.length > 0;

    if (!hasGs1LikeGtin) {
      return NextResponse.json(
        { error: 'SSCC generation is enabled only for GS1-mode companies (GTIN required).', code: 'gs1_required' },
        { status: 403 }
      );
    }

    // Validate required fields
    const normalizedExpiry = normalizeDateInput(expiry_date);

    if (!sku_id || !batch || !expiry_date || !number_of_pallets) {
      return NextResponse.json(
        { error: 'sku_id, batch, expiry_date, and number_of_pallets are required' },
        { status: 400 }
      );
    }
    if (!normalizedExpiry) {
      return NextResponse.json(
        { error: 'expiry_date must be YYYY-MM-DD', code: 'invalid_input' },
        { status: 400 }
      );
    }

    // Validate hierarchy rules
    if (generate_carton && !generate_box) {
      return NextResponse.json(
        { error: 'SSCC generation must follow hierarchy: Box → Carton → Pallet. Carton requires Box.' },
        { status: 400 }
      );
    }

    if (generate_pallet && (!generate_box || !generate_carton)) {
      return NextResponse.json(
        { error: 'SSCC generation must follow hierarchy: Box → Carton → Pallet. Pallet requires Box and Carton.' },
        { status: 400 }
      );
    }

    if (!generate_box && !generate_carton && !generate_pallet) {
      return NextResponse.json(
        { error: 'At least one SSCC level must be selected (Box, Carton, or Pallet)' },
        { status: 400 }
      );
    }

    // Validate hierarchy quantities
    if ((generate_carton || generate_pallet) && (!boxes_per_carton || boxes_per_carton < 1)) {
      return NextResponse.json(
        { error: 'boxes_per_carton is required when generating Carton or Pallet' },
        { status: 400 }
      );
    }

    if (generate_pallet && (!cartons_per_pallet || cartons_per_pallet < 1)) {
      return NextResponse.json(
        { error: 'cartons_per_pallet is required when generating Pallet' },
        { status: 400 }
      );
    }

    if (!units_per_box || units_per_box < 1) {
      return NextResponse.json(
        { error: 'units_per_box must be a positive integer' },
        { status: 400 }
      );
    }

    const skuUuid = await resolveSkuId({
      supabase,
      companyId: company_id,
      skuIdOrCode: sku_id,
    });

    // Get packing rule
    const { data: rule, error: ruleErr } = await supabase
      .from('packing_rules')
      .select('*')
      .eq('company_id', company_id)
      .eq('sku_id', skuUuid)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ruleErr || !rule) {
      return NextResponse.json(
        { error: 'Packing rule not found for selected SKU' },
        { status: 400 }
      );
    }

    const prefix = rule.sscc_company_prefix;
    const ext = rule.sscc_extension_digit;

    // Calculate total SSCC count needed (all levels combined)
    let totalSSCCCount = 0;
    if (generate_box) {
      // Boxes: number_of_pallets * boxes_per_carton * cartons_per_pallet
      const boxesPerPallet = (boxes_per_carton || 1) * (cartons_per_pallet || 1);
      totalSSCCCount += number_of_pallets * boxesPerPallet;
    }
    if (generate_carton) {
      // Cartons: number_of_pallets * cartons_per_pallet
      totalSSCCCount += number_of_pallets * (cartons_per_pallet || 1);
    }
    if (generate_pallet) {
      // Pallets: number_of_pallets
      totalSSCCCount += number_of_pallets;
    }

    if (totalSSCCCount > MAX_CODES_PER_ROW) {
      return NextResponse.json(
        {
          error: `Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`,
          code: 'limit_exceeded',
          requested: totalSSCCCount,
          max_per_row: MAX_CODES_PER_ROW,
          max_per_request: MAX_CODES_PER_REQUEST,
        },
        { status: 400 }
      );
    }
    if (totalSSCCCount > MAX_CODES_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Per request limit exceeded. Maximum ${MAX_CODES_PER_REQUEST.toLocaleString()} codes per request.`,
          code: 'limit_exceeded',
          requested: totalSSCCCount,
          max_per_row: MAX_CODES_PER_ROW,
          max_per_request: MAX_CODES_PER_REQUEST,
        },
        { status: 400 }
      );
    }

    const decision = await enforceEntitlement({
      companyId: company_id,
      usageType: UsageType.SSCC_LABEL,
      quantity: totalSSCCCount,
      requestId,
      metadata: { source: "sscc_generate" },
    });
    if (!decision.allow) {
      return NextResponse.json(
        {
          error: decision.reason_code,
          remaining: decision.remaining,
        },
        { status: 403 }
      );
    }

    // Mark entitlement consumed for error handling
    entitlementConsumed = true;
    consumedQuantity = totalSSCCCount;
    consumedCompanyId = company_id;

    // Allocate SSCC serials (after quota check passes)
    const { data: alloc, error: allocErr } = await supabase.rpc('allocate_sscc_serials', {
      p_sequence_key: prefix,
      p_count: totalSSCCCount,
    });

    if (allocErr) {
      await refundEntitlement({
        companyId: company_id,
        usageType: UsageType.SSCC_LABEL,
        quantity: totalSSCCCount,
      });
      return NextResponse.json(
        { error: allocErr.message ?? 'Failed to allocate SSCC serials' },
        { status: 400 }
      );
    }

    const firstSerial = alloc as any;
    const nowIso = new Date().toISOString();

    // Prepare all SSCC rows for atomic insertion
    const ssccRows: any[] = [];
    let serialOffset = 0;

    // Generate Boxes (if selected)
    if (generate_box) {
      const boxesPerPallet = (boxes_per_carton || 1) * (cartons_per_pallet || 1);
      const totalBoxes = number_of_pallets * boxesPerPallet;

      for (let i = 0; i < totalBoxes; i++) {
        const serial = Number(firstSerial) + serialOffset;
        const { data: ssccGen, error: ssccErr } = await supabase.rpc('make_sscc', {
          p_extension_digit: ext,
          p_company_prefix: prefix,
          p_serial: serial,
        });

        if (ssccErr || !ssccGen) {
          await refundEntitlement({
            companyId: company_id,
            usageType: UsageType.SSCC_LABEL,
            quantity: totalSSCCCount,
          });
          return NextResponse.json(
            { error: ssccErr?.message ?? 'Failed to generate SSCC for box' },
            { status: 400 }
          );
        }

        ssccRows.push({
          company_id: company_id,
          sku_id: skuUuid,
          sscc: ssccGen as any,
          sscc_with_ai: `(00)${ssccGen}`,
          code: ssccGen as any, // Set code to SSCC value (required by NOT NULL constraint)
          sscc_level: 'box',
          parent_sscc: null,
          meta: {
            created_at: nowIso,
            batch,
            expiry_date: normalizedExpiry,
            units_per_box: units_per_box,
            box_number: i + 1,
            packing_rule_id: rule.id,
          },
          created_at: nowIso,
        });
        serialOffset++;
      }
    }

    // Generate Cartons (if selected)
    if (generate_carton) {
      const totalCartons = number_of_pallets * (cartons_per_pallet || 1);

      for (let i = 0; i < totalCartons; i++) {
        const serial = Number(firstSerial) + serialOffset;
        const { data: ssccGen, error: ssccErr } = await supabase.rpc('make_sscc', {
          p_extension_digit: ext,
          p_company_prefix: prefix,
          p_serial: serial,
        });

        if (ssccErr || !ssccGen) {
          await refundEntitlement({
            companyId: company_id,
            usageType: UsageType.SSCC_LABEL,
            quantity: totalSSCCCount,
          });
          return NextResponse.json(
            { error: ssccErr?.message ?? 'Failed to generate SSCC for carton' },
            { status: 400 }
          );
        }

        ssccRows.push({
          company_id: company_id,
          sku_id: skuUuid,
          sscc: ssccGen as any,
          sscc_with_ai: `(00)${ssccGen}`,
          code: ssccGen as any, // Set code to SSCC value (required by NOT NULL constraint)
          sscc_level: 'carton',
          parent_sscc: null,
          meta: {
            created_at: nowIso,
            batch,
            expiry_date: normalizedExpiry,
            boxes_per_carton: boxes_per_carton,
            carton_number: i + 1,
            packing_rule_id: rule.id,
          },
          created_at: nowIso,
        });
        serialOffset++;
      }
    }

    // Generate Pallets (if selected)
    if (generate_pallet) {
      for (let i = 0; i < number_of_pallets; i++) {
        const serial = Number(firstSerial) + serialOffset;
        const { data: ssccGen, error: ssccErr } = await supabase.rpc('make_sscc', {
          p_extension_digit: ext,
          p_company_prefix: prefix,
          p_serial: serial,
        });

        if (ssccErr || !ssccGen) {
          return NextResponse.json(
            { error: ssccErr?.message ?? 'Failed to generate SSCC for pallet' },
            { status: 400 }
          );
        }

        ssccRows.push({
          company_id: company_id,
          sku_id: skuUuid,
          sscc: ssccGen as any,
          sscc_with_ai: `(00)${ssccGen}`,
          code: ssccGen as any, // Set code to SSCC value (if code column exists)
          sscc_level: 'pallet',
          parent_sscc: null,
          meta: {
            created_at: nowIso,
            batch,
            expiry_date: normalizedExpiry,
            cartons_per_pallet: cartons_per_pallet,
            pallet_number: i + 1,
            packing_rule_id: rule.id,
          },
          created_at: nowIso,
        });
        serialOffset++;
      }
    }

    // Insert all SSCCs into appropriate tables
    // Quota already consumed above, so proceed with insertion
    const insertedBoxes = ssccRows.filter(r => r.sscc_level === 'box').length > 0
      ? await supabase.from('boxes').insert(
          ssccRows.filter(r => r.sscc_level === 'box')
        ).select('id, sscc, sscc_with_ai, sku_id')
      : { data: [], error: null };

    const insertedCartons = ssccRows.filter(r => r.sscc_level === 'carton').length > 0
      ? await supabase.from('cartons').insert(
          ssccRows.filter(r => r.sscc_level === 'carton')
        ).select('id, sscc, sscc_with_ai, sku_id')
      : { data: [], error: null };

    const insertedPallets = ssccRows.filter(r => r.sscc_level === 'pallet').length > 0
      ? await supabase.from('pallets').insert(
          ssccRows.filter(r => r.sscc_level === 'pallet')
        ).select('id, sscc, sscc_with_ai, sku_id')
      : { data: [], error: null };

    // Check for insertion errors
    if (insertedBoxes.error || insertedCartons.error || insertedPallets.error) {
      await refundEntitlement({
        companyId: company_id,
        usageType: UsageType.SSCC_LABEL,
        quantity: totalSSCCCount,
      });

      const errorMsg = insertedBoxes.error?.message || insertedCartons.error?.message || insertedPallets.error?.message;
      return NextResponse.json(
        { error: errorMsg ?? 'Failed to insert SSCC codes' },
        { status: 500 }
      );
    }

    // TODO: Link parent-child relationships (box → carton, carton → pallet)
    // This requires updating boxes.carton_id and cartons.pallet_id

    return NextResponse.json({
      boxes: insertedBoxes.data || [],
      cartons: insertedCartons.data || [],
      pallets: insertedPallets.data || [],
      total_sscc_generated: totalSSCCCount,
    });
  } catch (err: any) {
    // If entitlement was consumed but an error occurred, try to refund
    if (entitlementConsumed && consumedQuantity > 0 && consumedCompanyId) {
      try {
        await refundEntitlement({
          companyId: consumedCompanyId,
          usageType: UsageType.SSCC_LABEL,
          quantity: consumedQuantity,
        });
      } catch (refundErr) {
        console.error('Failed to refund quota in error handler:', refundErr);
      }
    }
    
    return NextResponse.json(
      {
        error: 'Unable to generate SSCC codes right now. Please try again.',
        code: 'internal_error',
      },
      { status: 500 }
    );
  }
}

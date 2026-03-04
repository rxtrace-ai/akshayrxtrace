import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateCanonicalGS1 } from '@/lib/gs1Canonical';
import { resolveCodeMode } from '@/lib/codeMode';
import { buildPicUnitPayload } from '@/lib/picPayload';
import { enforceEntitlement, refundEntitlement } from '@/lib/entitlement/enforce';
import { UsageType } from '@/lib/entitlement/usageTypes';
import crypto from 'crypto';

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

function isoToYYMMDD(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid date: ${iso}`);
  const yy = String(dt.getFullYear()).slice(-2);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Generate unique serial number
const generateSerial = (companyId: string) =>
  `U${companyId.slice(0, 4)}${Date.now().toString(36)}${crypto
    .randomBytes(3)
    .toString('hex')}`;

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

export async function POST(req: Request) {
  // IMPORTANT:
  // Do NOT implement quota logic in this route.
  // All entitlement enforcement must use lib/entitlement/enforce.ts
  try {
    // Resolve company from auth
    const auth = await resolveAuthCompany();
    if ('error' in auth) return auth.error;

    const { companyId, companyName, userId } = auth;

    // Parse request body
    const body = await req.json().catch(() => ({}));
    
    const complianceAck = body.compliance_ack === true;
    if (!complianceAck) {
      return NextResponse.json(
        { error: 'compliance_ack=true is required', code: 'compliance_required' },
        { status: 400 }
      );
    }

    const gtinRaw = typeof body.gtin === 'string' ? body.gtin.trim() : '';
    const batch = typeof body.batch === 'string' ? body.batch.trim() : '';
    const mfdInput = typeof body.mfd === 'string' ? body.mfd.trim() || null : null;
    const expInput = typeof body.exp === 'string' ? body.exp.trim() : '';
    const quantity = typeof body.quantity === 'number' ? body.quantity : parseInt(String(body.quantity || '1'), 10);
    const mrp = body.mrp !== undefined ? String(body.mrp).trim() : '';
    const skuCode = typeof body.sku === 'string' ? body.sku.trim().toUpperCase() : '';
    const company = typeof body.company === 'string' ? body.company.trim() : companyName;

    const codeMode = resolveCodeMode({ gtin: gtinRaw });

    // Validate required fields
    if (!batch || !expInput || !quantity || quantity <= 0) {
      return NextResponse.json(
        { error: 'batch, expiry date, and quantity are required', code: 'invalid_input' },
        { status: 400 }
      );
    }
    const exp = normalizeDateInput(expInput);
    if (!exp) {
      return NextResponse.json(
        { error: 'Expiry date must be YYYY-MM-DD', code: 'invalid_input' },
        { status: 400 }
      );
    }
    const mfd = mfdInput ? normalizeDateInput(mfdInput) : null;
    if (mfdInput && !mfd) {
      return NextResponse.json(
        { error: 'Manufacturing date must be YYYY-MM-DD', code: 'invalid_input' },
        { status: 400 }
      );
    }
    if (quantity > MAX_CODES_PER_ROW) {
      return NextResponse.json(
        {
          error: `Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`,
          code: 'limit_exceeded',
          requested: quantity,
          max_per_row: MAX_CODES_PER_ROW,
          max_per_request: MAX_CODES_PER_REQUEST,
        },
        { status: 400 }
      );
    }
    if (quantity > MAX_CODES_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Per request limit exceeded. Maximum ${MAX_CODES_PER_REQUEST.toLocaleString()} codes per request.`,
          code: 'limit_exceeded',
          requested: quantity,
          max_per_row: MAX_CODES_PER_ROW,
          max_per_request: MAX_CODES_PER_REQUEST,
        },
        { status: 400 }
      );
    }

    // If SKU provided, ensure it exists
    let skuId: string | null = null;
    let finalSkuCode = skuCode;
    if (skuCode) {
      const admin = getSupabaseAdmin();
      const { data: sku } = await admin
        .from('skus')
        .select('id, sku_code')
        .eq('company_id', companyId)
        .eq('sku_code', skuCode)
        .maybeSingle();

      if (sku?.id) {
        skuId = sku.id;
        finalSkuCode = sku.sku_code;
      } else {
        // Auto-create SKU if not exists (non-blocking)
        try {
          const { data: newSku } = await admin
            .from('skus')
            .upsert(
              {
                company_id: companyId,
                sku_code: skuCode,
                sku_name: skuCode,
                deleted_at: null,
              },
              { onConflict: 'company_id,sku_code' }
            )
            .select('id, sku_code')
            .single();

          if (newSku?.id) {
            skuId = newSku.id;
            finalSkuCode = newSku.sku_code;
          }
        } catch {
          // Non-blocking: continue without SKU
        }
      }
    }

    const admin = getSupabaseAdmin();

    // Phase 4: persist GTIN on SKU master (best-effort; do not block generation)
    if (codeMode === 'GS1' && gtinRaw && finalSkuCode) {
      try {
        const { validateGTIN } = await import('@/lib/gs1/gtin');
        const validation = validateGTIN(gtinRaw);
        if (validation.valid && validation.normalized && skuId) {
          await admin
            .from('skus')
            .update({ gtin: validation.normalized })
            .eq('company_id', companyId)
            .eq('id', skuId);
        }
      } catch {
        // ignore
      }
    }

    const decision = await enforceEntitlement({
      companyId,
      usageType: UsageType.UNIT_LABEL,
      quantity,
      metadata: { source: "issues_generate" },
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

    // Generate unit serials and payloads (before quota check)
    const items: Array<{ serial: string; payload: string; code_mode: 'GS1' | 'PIC'; gs1: string }> = [];
    const unitRows: Array<{
      company_id: string;
      sku_id: string | null;
      gtin: string | null;
      batch: string;
      mfd: string;
      expiry: string;
      mrp: string | null;
      serial: string;
      gs1_payload: string;
      code_mode: 'GS1' | 'PIC';
      payload: string;
    }> = [];

    const maxAttempts = 10;
    const mfdDate = mfd || new Date().toISOString().split('T')[0]; // Use today if not provided

    let gtinForStorage = gtinRaw;
    if (codeMode === 'PIC') {
      if (!finalSkuCode) {
        return NextResponse.json(
          { error: 'sku is required when GTIN is not provided (PIC mode)', code: 'invalid_input' },
          { status: 400 }
        );
      }
      // Phase 2+ schema: gtin is nullable; no sentinel values.
      gtinForStorage = '';
    }

    // Generate all serials and payloads first
    for (let i = 0; i < quantity; i++) {
      let serial: string = '';
      let attempts = 0;
      let isUnique = false;

      // Generate unique serial (check against existing labels)
      while (!isUnique && attempts < maxAttempts) {
        serial = generateSerial(companyId);
        const { data: existing } = await admin
          .from('labels_units')
          .select('id')
          .eq('company_id', companyId)
          .eq('serial', serial)
          .maybeSingle();

        if (!existing) {
          isUnique = true;
        } else {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      if (!isUnique) {
        return NextResponse.json(
          { error: `Failed to generate unique serial after ${maxAttempts} attempts` },
          { status: 500 }
        );
      }

      const payload =
        codeMode === 'GS1'
          ? generateCanonicalGS1({
              gtin: gtinRaw,
              expiry: exp,
              mfgDate: mfdDate,
              batch,
              serial,
              mrp: mrp ? Number(mrp) : undefined,
              sku: finalSkuCode || undefined,
            })
          : buildPicUnitPayload({
              sku: finalSkuCode,
              batch,
              expiryYYMMDD: isoToYYMMDD(exp),
              mfgYYMMDD: mfd ? isoToYYMMDD(mfdDate) : undefined,
              serial,
              mrp: mrp || undefined,
            });

      // Back-compat: keep `gs1` field name for frontend, but it now means "payload".
      items.push({ serial, payload, code_mode: codeMode, gs1: payload });

      unitRows.push({
        company_id: companyId,
        sku_id: skuId,
        gtin: codeMode === 'GS1' ? gtinRaw : null,
        batch,
        mfd: mfdDate,
        expiry: exp,
        mrp: mrp || null,
        serial,
        gs1_payload: payload,
        code_mode: codeMode,
        payload,
      });
    }

    const { error: insertError } = await admin.from("labels_units").insert(unitRows);
    if (insertError) {
      await refundEntitlement({
        companyId,
        usageType: UsageType.UNIT_LABEL,
        quantity,
      });

      if (insertError.code === '23505' || insertError.message?.includes('unique') || insertError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'Duplicate serial detected. Please try again.' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error: 'Unable to generate unit labels right now. Please retry.',
          code: 'generation_failed',
        },
        { status: 500 }
      );
    }

    // Success: quota was consumed and labels were inserted atomically
    // Return format expected by frontend
    return NextResponse.json({
      items,
    });
  } catch (err: any) {
    console.error('Issues API error:', err);
    
    if (err?.code === 'PAST_DUE' || err?.code === 'SUBSCRIPTION_INACTIVE') {
      return NextResponse.json(
        { error: err.message || 'Subscription inactive', code: err.code },
        { status: 402 }
      );
    }

    return NextResponse.json(
      {
        error: 'Unable to generate unit codes right now. Please try again.',
        code: 'internal_error',
      },
      { status: 500 }
    );
  }
}

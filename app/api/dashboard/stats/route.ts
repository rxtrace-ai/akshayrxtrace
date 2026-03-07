import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyForUser } from '@/lib/company/resolve';
import { getCompanyEntitlementSnapshot } from '@/lib/entitlement/canonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  try {
    // Route handlers run server-side; use SSR client for auth cookies.
    const {
      data: { user },
      error: authError,
    } = await (await supabaseServer()).auth.getUser();

    if (!user || authError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client and canonical company resolver (owner + seat).
    const supabase = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(supabase, user.id, 'id, company_name');
    if (!resolved) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    const companyId = resolved.companyId;
    const company = resolved.company;

    // Billing usage (current trial/paid period): used label quotas are the most accurate
    // “realtime generation” counters because they are incremented atomically during create APIs.
    const entitlement = await getCompanyEntitlementSnapshot(supabase, companyId).catch((err) => {
      console.error('Failed to load entitlement snapshot:', err);
      return null;
    });

    // Total SKUs
    const { count: totalSkus, error: skuErr } = await supabase
      .from('skus')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('deleted_at', null);

    if (skuErr) {
      return NextResponse.json({ error: skuErr.message }, { status: 500 });
    }

    // Units generated: count of labels_units (authoritative store of generated unit labels).
    // If you use a different “formula” in Supabase (view/RPC), we can swap this.
    const { count: unitsGenerated, error: unitsErr } = await supabase
      .from('labels_units')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (unitsErr) {
      return NextResponse.json({ error: unitsErr.message }, { status: 500 });
    }

    // SSCC generated: pallets count
    const { count: ssccGenerated, error: palletsErr } = await supabase
      .from('pallets')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (palletsErr) {
      return NextResponse.json({ error: palletsErr.message }, { status: 500 });
    }

    // Total scans (company scans only)
    const { count: totalScans, error: scansErr } = await supabase
      .from('scan_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (scansErr) {
      return NextResponse.json({ error: scansErr.message }, { status: 500 });
    }

    // Scan breakdown by expiry status
    const { data: scanLogs, error: scanLogsErr } = await supabase
      .from('scan_logs')
      .select('metadata, status')
      .eq('company_id', companyId);

    if (scanLogsErr) {
      console.warn('Could not fetch scan breakdown:', scanLogsErr.message);
    }

    const validProductScans = (scanLogs || []).filter(log => {
      const expiryStatus = log.metadata?.expiry_status;
      return expiryStatus === 'VALID' || (!expiryStatus && log.status === 'SUCCESS');
    }).length;

    const expiredProductScans = (scanLogs || []).filter(log => {
      const expiryStatus = log.metadata?.expiry_status;
      return expiryStatus === 'EXPIRED' || (log.metadata?.error_reason === 'PRODUCT_EXPIRED');
    }).length;

    const duplicateScans = (scanLogs || []).filter(log => {
      return log.metadata?.status === 'DUPLICATE';
    }).length;

    const errorScans = (scanLogs || []).filter(log => {
      return log.status === 'ERROR' || log.status === 'FAILED';
    }).length;

    // Active handsets
    const { count: activeHandsets, error: handsetsErr } = await supabase
      .from('handsets')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'ACTIVE');

    if (handsetsErr) {
      return NextResponse.json({ error: handsetsErr.message }, { status: 500 });
    }

    // Active seats
    const { count: activeSeats, error: seatsErr } = await supabase
      .from('seats')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('active', true);

    if (seatsErr) {
      return NextResponse.json({ error: seatsErr.message }, { status: 500 });
    }

    // Recent activity from audit_logs (last 10 entries) - FIX: removed details column that doesn't exist
    const { data: recentActivity, error: activityErr } = await supabase
      .from('audit_logs')
      .select('id, action, status, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (activityErr) {
      console.warn('Could not fetch recent activity:', activityErr.message);
    }

    return NextResponse.json({
      company_id: companyId,
      company_name: (company?.company_name as string) ?? null,
      total_skus: totalSkus ?? 0,
      units_generated: unitsGenerated,
      sscc_generated: ssccGenerated ?? 0,
      total_scans: totalScans ?? 0,
      active_handsets: activeHandsets ?? 0,
      active_seats: activeSeats ?? 0,
      scan_breakdown: {
        valid_product_scans: validProductScans,
        expired_product_scans: expiredProductScans,
        duplicate_scans: duplicateScans,
        error_scans: errorScans,
      },
      label_generation: {
        unit: entitlement ? toNumber(entitlement.usage.unit) : 0,
        box: entitlement ? toNumber(entitlement.usage.box) : 0,
        carton: entitlement ? toNumber(entitlement.usage.carton) : 0,
        pallet: entitlement ? toNumber(entitlement.usage.pallet) : 0,
      },
      recent_activity: recentActivity ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyForUser } from '@/lib/company/resolve';
import { getCompanyEntitlementSnapshot } from '@/lib/entitlement/canonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Scope = 'full' | 'core' | 'activity';

function parseScope(value: string | null): Scope {
  if (value === 'core' || value === 'activity') return value;
  return 'full';
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getRecentActivity(supabase: ReturnType<typeof getSupabaseAdmin>, companyId: string) {
  const { data: recentActivity, error: activityErr } = await supabase
    .from('audit_logs')
    .select('id, action, status, metadata, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (activityErr) {
    console.warn('Could not fetch recent activity:', activityErr.message);
    return [];
  }
  return recentActivity ?? [];
}

export async function GET(request: NextRequest) {
  try {
    const {
      data: { user },
      error: authError,
    } = await (await supabaseServer()).auth.getUser();

    if (!user || authError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const scope = parseScope(request.nextUrl.searchParams.get('scope'));
    const supabase = getSupabaseAdmin();
    const resolved = await resolveCompanyForUser(supabase, user.id, 'id, company_name');
    if (!resolved) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const companyId = resolved.companyId;
    const company = resolved.company;

    if (scope === 'activity') {
      const recentActivity = await getRecentActivity(supabase, companyId);
      return NextResponse.json({
        company_id: companyId,
        company_name: (company?.company_name as string) ?? null,
        recent_activity: recentActivity,
      });
    }

    const [
      entitlement,
      skusResult,
      unitsResult,
      palletsResult,
      scansResult,
      handsetsResult,
      seatsResult,
      recentActivity,
      scanLogsResult,
    ] = await Promise.all([
      getCompanyEntitlementSnapshot(supabase, companyId).catch((err) => {
        console.error('Failed to load entitlement snapshot:', err);
        return null;
      }),
      supabase
        .from('skus')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .is('deleted_at', null),
      supabase
        .from('labels_units')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('pallets')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('scan_logs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      supabase
        .from('handsets')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'ACTIVE'),
      supabase
        .from('seats')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('active', true),
      scope === 'full' ? getRecentActivity(supabase, companyId) : Promise.resolve([]),
      scope === 'full'
        ? supabase
            .from('scan_logs')
            .select('metadata, status')
            .eq('company_id', companyId)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (skusResult.error) return NextResponse.json({ error: skusResult.error.message }, { status: 500 });
    if (unitsResult.error) return NextResponse.json({ error: unitsResult.error.message }, { status: 500 });
    if (palletsResult.error) return NextResponse.json({ error: palletsResult.error.message }, { status: 500 });
    if (scansResult.error) return NextResponse.json({ error: scansResult.error.message }, { status: 500 });
    if (handsetsResult.error) return NextResponse.json({ error: handsetsResult.error.message }, { status: 500 });
    if (seatsResult.error) return NextResponse.json({ error: seatsResult.error.message }, { status: 500 });
    if (scanLogsResult.error) return NextResponse.json({ error: scanLogsResult.error.message }, { status: 500 });

    const responseBody: Record<string, unknown> = {
      company_id: companyId,
      company_name: (company?.company_name as string) ?? null,
      total_skus: skusResult.count ?? 0,
      units_generated: unitsResult.count ?? 0,
      sscc_generated: palletsResult.count ?? 0,
      total_scans: scansResult.count ?? 0,
      active_handsets: handsetsResult.count ?? 0,
      active_seats: seatsResult.count ?? 0,
      label_generation: {
        unit: entitlement ? toNumber(entitlement.usage.unit) : 0,
        box: entitlement ? toNumber(entitlement.usage.box) : 0,
        carton: entitlement ? toNumber(entitlement.usage.carton) : 0,
        pallet: entitlement ? toNumber(entitlement.usage.pallet) : 0,
      },
    };

    if (scope === 'full') {
      const scanLogs = (scanLogsResult.data as any[]) || [];
      const validProductScans = scanLogs.filter((log) => {
        const expiryStatus = log.metadata?.expiry_status;
        return expiryStatus === 'VALID' || (!expiryStatus && log.status === 'SUCCESS');
      }).length;

      const expiredProductScans = scanLogs.filter((log) => {
        const expiryStatus = log.metadata?.expiry_status;
        return expiryStatus === 'EXPIRED' || log.metadata?.error_reason === 'PRODUCT_EXPIRED';
      }).length;

      const duplicateScans = scanLogs.filter((log) => log.metadata?.status === 'DUPLICATE').length;
      const errorScans = scanLogs.filter((log) => log.status === 'ERROR' || log.status === 'FAILED').length;

      responseBody.scan_breakdown = {
        valid_product_scans: validProductScans,
        expired_product_scans: expiredProductScans,
        duplicate_scans: duplicateScans,
        error_scans: errorScans,
      };
      responseBody.recent_activity = recentActivity;
    }

    return NextResponse.json(responseBody);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

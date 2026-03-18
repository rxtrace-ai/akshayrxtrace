/**
 * Canonical company resolver for RXTrace.
 * Single source of truth: resolve company for an authenticated user.
 * 1) Owner: companies.user_id = userId.
 * 2) Member/seat: fallback via seats table (user_id, status = 'active').
 * RXTrace requirement: companyId must not be null when a company exists for that user.
 * Use with admin client in API routes so both owner and seat paths work (RLS bypass).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SELECT = 'id';

export type ResolveResult = {
  companyId: string;
  company: Record<string, unknown>;
  /** True if user owns company (companies.user_id), false if access via active seat. */
  isOwner: boolean;
};

/**
 * Resolve company for a user: owner first, then active seat.
 * Uses companies.user_id; if no row, tries seats where user_id and status = 'active'.
 * RXTrace: Single canonical resolver everywhere. No redirect when resolved; HARD ERROR when no company.
 */
export async function resolveCompanyForUser(
  supabase: SupabaseClient,
  userId: string,
  select: string = DEFAULT_SELECT
): Promise<ResolveResult | null> {
  // 1) Owner: companies.user_id = userId
  const { data: company, error } = await supabase
    .from('companies')
    .select(select)
    .eq('user_id', userId)
    .maybeSingle();

  const companyRecord = company as Record<string, unknown> | null;
  const ownerCompanyId =
    companyRecord && typeof companyRecord.id === 'string' ? companyRecord.id : null;

  if (!error && ownerCompanyId) {
    return {
      companyId: ownerCompanyId,
      company: companyRecord as Record<string, unknown>,
      isOwner: true,
    };
  }

  // 2) Seat fallback: first active seat for this user
  const { data: seats, error: seatErr } = await supabase
    .from('seats')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  const seat = seats?.[0];
  if (seatErr || !seat?.company_id) {
    return null;
  }

  const { data: companyBySeat, error: companyErr } = await supabase
    .from('companies')
    .select(select)
    .eq('id', seat.company_id)
    .maybeSingle();

  const seatCompanyRecord = companyBySeat as Record<string, unknown> | null;
  const seatCompanyId =
    seatCompanyRecord && typeof seatCompanyRecord.id === 'string' ? seatCompanyRecord.id : null;

  if (companyErr || !seatCompanyId) {
    return null;
  }

  return {
    companyId: seatCompanyId,
    company: seatCompanyRecord as Record<string, unknown>,
    isOwner: false,
  };
}

/**
 * Resolve company ID from API request (Bearer or cookie auth).
 * Uses canonical resolver - works for owner and active seat.
 */
export async function resolveCompanyIdFromRequest(req: Request): Promise<string | null> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin');
  const { supabaseServer } = await import('@/lib/supabase/server');
  const admin = getSupabaseAdmin();

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const { data: { user }, error } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!error && user) {
      const resolved = await resolveCompanyForUser(admin, user.id, 'id');
      return resolved?.companyId ?? null;
    }
  }

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const resolved = await resolveCompanyForUser(admin, user.id, 'id');
  return resolved?.companyId ?? null;
}

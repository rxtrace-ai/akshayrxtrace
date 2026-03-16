import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCompanyForUser } from '@/lib/company/resolve';

export const dynamic = 'force-dynamic';

const COMPANY_SETUP_ROUTE = '/onboarding/company-setup';

function getSafeNextPath(nextPath: string | null): string | null {
  if (!nextPath || !nextPath.startsWith('/')) return null;
  if (nextPath.startsWith('//')) return null;
  return nextPath;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  // Handle OAuth errors
  if (error) {
    console.error('OAuth callback error:', error, errorDescription);
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(errorDescription || error)}`, request.url)
    );
  }

  let userId: string | null = null;
  let userEmail: string | null = null;
  let userFullName: string | null = null;

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    const { data, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError) {
      console.error('Session exchange error:', sessionError);
      return NextResponse.redirect(
        new URL(`/auth/signin?error=${encodeURIComponent(sessionError.message)}`, request.url)
      );
    }

    if (!data?.session) {
      console.error('No session returned after code exchange');
      return NextResponse.redirect(
        new URL('/auth/signin?error=Authentication failed', request.url)
      );
    }

    userId = data.session.user.id;
    userEmail = data.session.user.email ? String(data.session.user.email).toLowerCase().trim() : null;
    userFullName =
      (typeof data.session.user.user_metadata?.full_name === 'string' &&
        data.session.user.user_metadata.full_name.trim()) ||
      userEmail ||
      null;
  }

  // Check if there's a next parameter for redirect
  const nextPath = getSafeNextPath(requestUrl.searchParams.get('next'));
  let redirectTo = nextPath || '/dashboard';

  if (userId) {
    const admin = getSupabaseAdmin();
    await admin
      .from('user_profiles')
      .upsert(
        {
          id: userId,
          user_id: userId,
          email: userEmail,
          full_name: userFullName || '',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .then(() => undefined)
      .catch(() => undefined);

    const resolved = await resolveCompanyForUser(admin, userId, 'id');
    const hasCompany = Boolean(resolved?.companyId);

    if (!hasCompany) {
      if (!nextPath || nextPath.startsWith('/dashboard')) {
        redirectTo = COMPANY_SETUP_ROUTE;
      }
    } else if (nextPath && (nextPath === COMPANY_SETUP_ROUTE || nextPath.startsWith(`${COMPANY_SETUP_ROUTE}/`))) {
      redirectTo = '/dashboard';
    }
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(new URL(redirectTo, request.url));
}

// middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveCompanyForUser } from '@/lib/company/resolve';
import { getUnifiedSubscriptionStatus } from '@/lib/billing/subscriptionStatus';
import { isTrustedOrigin, shouldEnforceCsrfForApi } from '@/lib/security/csrf';

const COMPANY_SETUP_ROUTE = '/onboarding/company-setup';
const TRIAL_ACTIVATION_PATH = '/dashboard/settings';

function withTrialActivationReason(request: NextRequest) {
  const url = new URL(TRIAL_ACTIVATION_PATH, request.url);
  url.searchParams.set('onboarding', 'trial_activation');
  return url;
}

function isOwnerActivationAllowedRoute(pathname: string) {
  return (
    pathname === TRIAL_ACTIVATION_PATH ||
    pathname.startsWith('/dashboard/subscription') ||
    pathname.startsWith('/dashboard/checkout')
  );
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isMachineAuthApiRoute =
    pathname.startsWith('/api/internal/') ||
    pathname === '/api/razorpay/webhook';

  // Exempt only explicitly public routes from auth checks.
  const publicPrefixes = [
    '/api/public',
    '/api/health',
  ];
  const publicExactRoutes = new Set([
    '/',
    '/pricing',
    '/compliance',
    '/contact',
    '/auth/verify',
    '/auth/callback',
    '/auth/signin',
    '/auth/signup',
    '/api/auth/send-otp',
    '/api/auth/verify-otp',
    '/api/public/seat-invitations/preview',
  ]);

  const isPublicRoute =
    publicExactRoutes.has(pathname) ||
    publicPrefixes.some((prefix) => pathname.startsWith(prefix));
  
  if (isPublicRoute) {
    return supabaseResponse;
  }
  
  // PHASE-1: Protect API routes (except public ones)
  if (pathname.startsWith('/api/')) {
    if (isMachineAuthApiRoute) {
      // Internal/webhook routes enforce their own shared-secret/signature checks.
      return supabaseResponse;
    }

    if (shouldEnforceCsrfForApi(request, pathname) && !isTrustedOrigin(request)) {
      return NextResponse.json({ error: 'CSRF_ORIGIN_DENIED' }, { status: 403 });
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    return supabaseResponse;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isProtectedArea =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/regulator') ||
    pathname.startsWith('/onboarding');

  if (isProtectedArea && !session) {
    return NextResponse.redirect(new URL('/auth/signin', request.url));
  }

  const isDashboardRoute = pathname.startsWith('/dashboard');
  const isOnboardingCompanySetupRoute =
    pathname === COMPANY_SETUP_ROUTE || pathname.startsWith(`${COMPANY_SETUP_ROUTE}/`);
  const isLegacyDashboardCompanySetupRoute =
    pathname === '/dashboard/company-setup' || pathname.startsWith('/dashboard/company-setup/');
  // Dashboard/onboarding: canonical company resolver (owner + active seat). No owner-only logic.
  if (session && (isDashboardRoute || pathname.startsWith('/onboarding'))) {
    if (!isDashboardRoute && !isOnboardingCompanySetupRoute) {
      return NextResponse.redirect(new URL(COMPANY_SETUP_ROUTE, request.url));
    }

    if (isLegacyDashboardCompanySetupRoute) {
      return NextResponse.redirect(new URL(COMPANY_SETUP_ROUTE, request.url));
    }

    if (isOnboardingCompanySetupRoute && pathname !== COMPANY_SETUP_ROUTE) {
      return NextResponse.redirect(new URL(COMPANY_SETUP_ROUTE, request.url));
    }

    const resolved = await resolveCompanyForUser(
      supabase,
      session.user.id,
      'id, profile_completed'
    );

    if (!resolved) {
      if (isOnboardingCompanySetupRoute) {
        return supabaseResponse;
      }
      return NextResponse.redirect(new URL(COMPANY_SETUP_ROUTE, request.url));
    }

    const company = resolved.company as Record<string, unknown>;
    if (resolved.isOwner && company.profile_completed === false) {
      if (isOnboardingCompanySetupRoute || pathname.startsWith('/dashboard/settings/erp-integration')) {
        return supabaseResponse;
      }
      const companySetupUrl = new URL(COMPANY_SETUP_ROUTE, request.url);
      companySetupUrl.searchParams.set('reason', 'complete_profile');
      return NextResponse.redirect(companySetupUrl);
    }

    if (resolved.isOwner) {
      const status = await getUnifiedSubscriptionStatus({
        supabase: supabase as any,
        companyId: resolved.companyId,
      });
      const hasOperationalAccess =
        status.status === 'active' || status.status === 'pending';

      if (!hasOperationalAccess) {
        if (isOnboardingCompanySetupRoute) {
          return NextResponse.redirect(withTrialActivationReason(request));
        }

        if (!isOwnerActivationAllowedRoute(pathname)) {
          return NextResponse.redirect(withTrialActivationReason(request));
        }
      } else if (pathname === TRIAL_ACTIVATION_PATH && request.nextUrl.searchParams.get('onboarding') === 'trial_activation') {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
    }

    if (isOnboardingCompanySetupRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // Access control: completed profiles can access dashboard routes.
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/dashboard/:path*', '/regulator/:path*', '/onboarding/:path*', '/api/:path*', '/pricing', '/auth/callback'],
};

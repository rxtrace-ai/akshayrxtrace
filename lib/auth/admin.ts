// PHASE-1: Admin role verification utilities
// This module provides functions to check and enforce admin role requirements

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

function normalizeAdminRole(role: unknown): string {
  return String(role ?? '').trim().toLowerCase();
}

async function resolveAuthenticatedUser(): Promise<{
  userId: string | null;
  error?: NextResponse;
  source?: 'cookie' | 'authorization';
}> {
  try {
    const supabase = await supabaseServer();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (user?.id) {
      return { userId: user.id, source: 'cookie' };
    }

    const headersList = await headers();
    const authHeader = headersList.get('authorization') || headersList.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (token) {
        const admin = getSupabaseAdmin();
        const { data: { user: tokenUser }, error: tokenError } = await admin.auth.getUser(token);
        if (tokenUser?.id) {
          return { userId: tokenUser.id, source: 'authorization' };
        }
        if (tokenError) {
          console.warn('PHASE-1: Authorization bearer auth failed:', tokenError.message);
        }
      }
    }

    if (authError) {
      console.warn('PHASE-1: Cookie auth failed:', authError.message);
    }

    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  } catch (error) {
    console.error('PHASE-1: Error resolving authenticated user:', error);
    return {
      userId: null,
      error: NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    };
  }
}

/**
 * PHASE-1: Check if a user is an admin
 * Admin status is stored in auth.users.user_metadata.is_admin or a separate admin_users table
 */
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const role = await getAdminRole(userId);
    if (role) return true;

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      if (error.code !== 'user_not_found') {
        console.warn('PHASE-1: Could not fetch user metadata for admin check:', error.message);
      }
      return false;
    }
    const user = (data as any)?.user;
    const meta = user?.user_metadata ?? user?.raw_user_meta_data;
    return meta?.is_admin === true;
  } catch (error) {
    console.error('PHASE-1: Error in isAdmin check:', error);
    return false;
  }
}

/**
 * PHASE-1: Get current user from session and check if admin
 */
export async function getCurrentUserIsAdmin(): Promise<{ isAdmin: boolean; userId: string | null; error?: NextResponse }> {
  try {
    const auth = await resolveAuthenticatedUser();
    if (auth.error || !auth.userId) {
      return {
        isAdmin: false,
        userId: null,
        error: auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }

    const adminStatus = await isAdmin(auth.userId);
    
    return {
      isAdmin: adminStatus,
      userId: auth.userId,
    };
  } catch (error) {
    console.error('PHASE-1: Error in getCurrentUserIsAdmin:', error);
    return {
      isAdmin: false,
      userId: null,
      error: NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    };
  }
}

/**
 * PHASE-1: Require admin role - throws error response if not admin
 * Use this in admin API routes to enforce admin access
 */
export async function requireAdmin(): Promise<{ userId: string; error?: NextResponse }> {
  const { isAdmin, userId, error } = await getCurrentUserIsAdmin();
  
  if (error) {
    return { userId: userId || '', error };
  }
  
  if (!isAdmin) {
    return {
      userId: userId || '',
      error: NextResponse.json(
        { 
          error: 'Forbidden', 
          message: 'Admin access required' 
        },
        { status: 403 }
      ),
    };
  }
  
  return { userId: userId! };
}

/**
 * PHASE-1: Set admin status for a user
 * This should only be called by super admins or during initial setup
 */
export async function setAdminStatus(userId: string, isAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = getSupabaseAdmin();
    
    // PHASE-1: Update user metadata
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { is_admin: isAdmin },
    });
    
    if (updateError) {
      return { success: false, error: updateError.message };
    }
    
    // PHASE-1: Also update admin_users table if it exists
    try {
      const { error: tableError } = await admin
        .from('admin_users')
        .upsert({
          user_id: userId,
          is_active: isAdmin,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });
      
      if (tableError && tableError.code !== '42P01') { // Ignore if table doesn't exist
        console.warn('PHASE-1: Could not update admin_users table:', tableError);
      }
    } catch (tableErr) {
      // PHASE-1: Table might not exist, that's okay
      console.warn('PHASE-1: admin_users table might not exist:', tableErr);
    }
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * PHASE-1: Get all admin users
 */
export async function getAllAdmins(): Promise<Array<{ userId: string; email?: string }>> {
  try {
    const admin = getSupabaseAdmin();
    
    // PHASE-1: Get users with is_admin in metadata
    const { data: { users }, error: listError } = await admin.auth.admin.listUsers();
    
    if (listError) {
      console.error('PHASE-1: Error listing users:', listError);
      return [];
    }
    
    const admins = users
      .filter(user => user.user_metadata?.is_admin === true)
      .map(user => ({
        userId: user.id,
        email: user.email,
      }));
    
    return admins;
  } catch (error) {
    console.error('PHASE-1: Error in getAllAdmins:', error);
    return [];
  }
}

export async function getAdminRole(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const tryQuery = async (column: 'user_id' | 'id') => {
      const withIsActive = await admin
        .from('admin_users')
        .select('id, user_id, role, role_name, is_active')
        .eq(column, userId)
        .maybeSingle();

      if (!withIsActive.error && withIsActive.data) return withIsActive.data as any;

      const withoutIsActive = await admin
        .from('admin_users')
        .select('id, user_id, role, role_name')
        .eq(column, userId)
        .maybeSingle();

      if (!withoutIsActive.error && withoutIsActive.data) return withoutIsActive.data as any;
      return null;
    };

    let data = await tryQuery('user_id');
    if (!data) data = await tryQuery('id');
    if (!data) return null;

    if (Object.prototype.hasOwnProperty.call(data, 'is_active') && data.is_active === false) {
      return null;
    }

    const roleName = normalizeAdminRole(data.role_name);
    if (roleName) return roleName;
    return normalizeAdminRole(data.role);
  } catch {
    return null;
  }
}

export async function requireAdminRole(
  allowedRoles: Array<'super_admin' | 'billing_admin' | 'support_admin'>
): Promise<{ userId: string; role: string | null; error?: NextResponse }> {
  const auth = await resolveAuthenticatedUser();
  if (auth.error || !auth.userId) {
    return {
      userId: auth.userId || '',
      role: null,
      error: auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const role = await getAdminRole(auth.userId);
  const normalized = normalizeAdminRole(role);
  const alias = normalized === 'superadmin' ? 'super_admin' : normalized;

  console.info('PHASE-1 admin role resolution', {
    userId: auth.userId,
    role_raw: role,
    role_normalized: alias || null,
    allowedRoles,
  });

  if (!alias) {
    return {
      userId: auth.userId,
      role: null,
      error: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'Admin access required',
        },
        { status: 403 }
      ),
    };
  }

  if (!allowedRoles.includes(alias as any)) {
    return {
      userId: auth.userId,
      role: alias || null,
      error: NextResponse.json(
        {
          error: 'Forbidden',
          message: `Requires role: ${allowedRoles.join(', ')}`,
        },
        { status: 403 }
      ),
    };
  }

  return { userId: auth.userId, role: alias || null };
}

export async function requireSuperAdmin(): Promise<{ userId: string; role: string | null; error?: NextResponse }> {
  return requireAdminRole(['super_admin']);
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { data: { user }, error: authError } = await (await supabaseServer()).auth.getUser();

    if (!user || authError) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { full_name, phone } = await req.json();

    // Validate: email and user_id cannot be changed
    // Only full_name and phone are editable

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update user profile (upsert - create if not exists, update if exists)
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        user_id: user.id,
        full_name: full_name?.trim() || null,
        phone: phone?.trim() || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
        ignoreDuplicates: false,
      })
      .select('id, email, full_name, phone')
      .single();

    if (profileError) {
      console.error('Profile update error:', profileError);
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      );
    }

    // Also update user metadata in auth.users (non-blocking)
    await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: {
        full_name: full_name?.trim() || null,
      },
    }).catch(err => console.warn('Failed to update auth metadata:', err));

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        phone: profile.phone,
      },
    });
  } catch (error: any) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update profile' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { fullName } = await req.json();

    if (!user.email) {
      return NextResponse.json(
        { error: 'Authenticated user email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = user.email.toLowerCase();

    // Save to user_profiles table
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        user_id: user.id,
        email: normalizedEmail,
        full_name: fullName || '',
        created_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) {
      console.error('Profile creation error:', error);
      // Don't return error - signup should continue even if profile save fails
    }

    return NextResponse.json({
      success: true,
      message: 'Profile created',
    });
  } catch (error) {
    console.error('Create profile error:', error);
    return NextResponse.json(
      { error: 'Failed to create profile' },
      { status: 500 }
    );
  }
}

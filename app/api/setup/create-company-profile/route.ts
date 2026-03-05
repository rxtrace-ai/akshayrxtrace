import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

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

    const {
      company_name,
      contact_person_name,
      firm_type,
      address,
      email,
      phone,
      pan,
      gst,
      business_category,
      business_type,
    } = await req.json();

    // Validate required fields
    if (!company_name || !contact_person_name || !firm_type || !address || !email || !phone || !pan || !business_category || !business_type) {
      return NextResponse.json(
        { error: 'Missing required fields. PAN card is mandatory.' },
        { status: 400 }
      );
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Validate firm type
    const validFirmTypes = ['proprietorship', 'partnership', 'llp', 'pvt_ltd', 'ltd'];
    if (!validFirmTypes.includes(firm_type)) {
      return NextResponse.json(
        { error: 'Invalid firm type' },
        { status: 400 }
      );
    }

    // Validate business fields
    const validCategories = ['pharma', 'food', 'dairy', 'logistics'];
    const validTypes = ['manufacturer', 'exporter', 'distributor', 'wholesaler'];
    
    if (!validCategories.includes(business_category)) {
      return NextResponse.json(
        { error: 'Invalid business category' },
        { status: 400 }
      );
    }

    if (!validTypes.includes(business_type)) {
      return NextResponse.json(
        { error: 'Invalid business type' },
        { status: 400 }
      );
    }

    // Check if company already exists for this user
    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingCompany) {
      return NextResponse.json(
        { error: 'Company profile already exists for this user' },
        { status: 409 }
      );
    }

    // Insert company profile
    const { data: company, error: insertError } = await supabase
      .from('companies')
      .insert({
        user_id: user.id,
        company_name: company_name.trim(),
        contact_person_name: contact_person_name.trim(),
        firm_type,
        address: address.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        pan: pan.toUpperCase().trim(),
        gst: gst ? gst.toUpperCase().trim() : null,
        business_category,
        business_type,
        subscription_status: null,
        created_at: new Date().toISOString(),
      })
      .select('id, company_name, email')
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create company profile. Please try again.' },
        { status: 500 }
      );
    }

    // Auto-create the owner seat as ACTIVE. Starter plan includes 1 seat and
    // the owner should not need an invite.
    try {
      const ownerEmail = String(user.email ?? email ?? '').trim().toLowerCase();

      // Avoid duplicates if the setup flow is retried.
      const { data: existingSeat } = await supabase
        .from('seats')
        .select('id')
        .eq('company_id', company.id)
        .or(`user_id.eq.${user.id},email.eq.${ownerEmail}`)
        .maybeSingle();

      if (!existingSeat) {
        const now = new Date().toISOString();
        await supabase
          .from('seats')
          .insert({
            company_id: company.id,
            user_id: user.id,
            email: ownerEmail || null,
            role: 'admin',
            active: true,
            status: 'active',
            invited_at: now,
            activated_at: now,
            created_at: now,
          });
      }
    } catch (seatError) {
      // Don't fail company creation if seat creation fails; user can still invite/buy seats.
      console.error('Failed to auto-create owner seat:', seatError);
    }

    return NextResponse.json({
      success: true,
      message: 'Company profile created successfully',
      company: {
        id: company.id,
        company_name: company.company_name,
        email: company.email,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Create company profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  );
}

import { NextRequest, NextResponse  } from 'next/server';
import { apiJson } from '@/lib/api/response';
import { supabaseServer } from '@/lib/supabase/server';
import { isIndustryOption } from '@/lib/companies/industry';
import { sanitizeFilterToken } from '@/lib/api/filter';

export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return apiJson(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      company_name,
      name,
      contact_person,
      contact_person_name,
      firm_type,
      address,
      phone,
      pan,
      gst_number,
      industry,
      business_category,
      business_type,
      created_at,
    } = await req.json();

    const fallbackContactPerson = String(
      user.user_metadata?.full_name || user.email || ''
    ).trim();
    const resolvedContactPerson = String(contact_person || contact_person_name || '').trim() || fallbackContactPerson;

    // Validate required fields
    const resolvedCompanyName = String(company_name || name || '').trim();
    if (!resolvedCompanyName || !resolvedContactPerson || !address || !phone || !industry || !business_type) {
      return apiJson(
        { error: 'Missing required fields.' },
        { status: 400 }
      );
    }

    // Validate firm type
    const normalizedFirmType = String(firm_type || '').trim().toLowerCase();
    const normalizedBusinessType = String(business_type || '').trim().toLowerCase();
    const normalizedIndustry = String(industry || '').trim();
    if (!isIndustryOption(normalizedIndustry)) {
      return apiJson(
        { error: 'Invalid industry selection.' },
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
      return apiJson(
        { error: 'Company profile already exists for this user' },
        { status: 409 }
      );
    }

    // Insert company profile
    const { data: company, error: insertError } = await supabase
      .from('companies')
      .insert({
        user_id: user.id,
        company_name: resolvedCompanyName,
        contact_person: resolvedContactPerson,
        firm_type: normalizedFirmType || null,
        address: address.trim(),
        phone: phone.trim(),
        pan: pan ? pan.toUpperCase().trim() : null,
        gst_number: gst_number ? gst_number.toUpperCase().trim() : null,
        industry: normalizedIndustry,
        business_category: business_category ? String(business_category).trim().toLowerCase() : null,
        business_type: normalizedBusinessType,
        created_at: created_at ? new Date(created_at) : new Date(),
        profile_completed: true,
      })
      .select('id, company_name')
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      return apiJson(
        { error: 'Failed to create company profile. Please try again.' },
        { status: 500 }
      );
    }

    // Auto-create the owner seat as ACTIVE. Starter plan includes 1 seat and
    // the owner should not need an invite.
    try {
      const ownerEmail = String(user.email ?? '').trim().toLowerCase();
      const safeOwnerEmail = sanitizeFilterToken(ownerEmail, 120);

      // Avoid duplicates if the setup flow is retried.
      const { data: existingSeatByUser } = await supabase
        .from('seats')
        .select('id')
        .eq('company_id', company.id)
        .eq('user_id', user.id)
        .maybeSingle();

      const { data: existingSeatByEmail } = !existingSeatByUser && safeOwnerEmail
        ? await supabase
            .from('seats')
            .select('id')
            .eq('company_id', company.id)
            .eq('email', safeOwnerEmail)
            .maybeSingle()
        : { data: null as any };

      if (!existingSeatByUser && !existingSeatByEmail) {
        const now = new Date().toISOString();
        await supabase
          .from('seats')
          .insert({
            company_id: company.id,
            user_id: user.id,
            email: safeOwnerEmail || null,
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

    return apiJson({
      success: true,
      message: 'Company profile created successfully',
      company: {
        id: company.id,
        company_name: company.company_name,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Create company profile error:', error);
    return apiJson(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return apiJson(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 }
  );
}


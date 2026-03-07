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

    const { company_name, phone, pan, gst_number, address } = await req.json();

    // Validate: company_id, user_id, and email cannot be changed
    // Only mutable company profile fields are editable here.

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's company
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, user_id, email, company_name, phone, pan, gst_number:gst, address')
      .eq('user_id', user.id)
      .maybeSingle();

    if (companyError || !company) {
      return NextResponse.json(
        { error: 'Company not found' },
        { status: 404 }
      );
    }

    // Validate: Prevent email, user_id, and company_id changes
    // Only update editable fields
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (company_name !== undefined) {
      updateData.company_name = company_name?.trim() || null;
    }

    if (phone !== undefined) {
      updateData.phone = phone?.trim() || null;
    }

    if (pan !== undefined) {
      updateData.pan = pan ? pan.toUpperCase().trim() : null;
    }

    if (gst_number !== undefined) {
      updateData.gst = gst_number ? gst_number.toUpperCase().trim() : null;
    }

    if (address !== undefined) {
      updateData.address = address?.trim() || null;
    }

    // Update company profile
    const { data: updatedCompany, error: updateError } = await supabase
      .from('companies')
      .update(updateData)
      .eq('id', company.id)
      .eq('user_id', user.id) // Ensure user owns this company
      .select('id, company_name, phone, pan, gst_number:gst, address, email, user_id')
      .single();

    if (updateError) {
      console.error('Company update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update company profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Company profile updated successfully',
      company: {
        id: updatedCompany.id,
        company_name: updatedCompany.company_name,
        phone: updatedCompany.phone,
        pan: updatedCompany.pan,
        gst_number: updatedCompany.gst_number,
        address: updatedCompany.address,
        email: updatedCompany.email, // Read-only, returned for display
        user_id: updatedCompany.user_id, // Read-only, returned for display
      },
    });
  } catch (error: any) {
    console.error('Update company profile error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update company profile' },
      { status: 500 }
    );
  }
}

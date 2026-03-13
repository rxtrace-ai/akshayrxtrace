'use server';

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { isIndustryOption } from '@/lib/companies/industry';

export type CompanySetupResult = 
  | { success: true; companyId: string; message: string }
  | { success: false; error: string; details?: string };

/**
 * Server action to create or update company profile
 * 
 * This is the ONLY backend execution path for company creation.
 * All company inserts must go through this action.
 * 
 * Security:
 * - Validates authenticated user
 * - Prevents duplicate company creation (unique constraint on user_id)
 * - Logs all errors for audit
 * - Uses admin client for inserts (bypasses RLS)
 */
export async function createOrUpdateCompanyProfile(
  data: {
    name?: string;
    company_name: string;
    contact_person?: string;
    phone: string;
    address: string;
    industry: string;
    business_type: string;
    firm_type?: string;
    business_category?: string;
    gst_number?: string;
    pan?: string;
    created_at?: string;
  }
): Promise<CompanySetupResult> {
  try {
    // 1. Get authenticated user
    const supabase = await supabaseServer();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('[Company Setup] Auth error:', userError);
      return {
        success: false,
        error: 'Authentication required',
        details: userError?.message || 'User not authenticated'
      };
    }

    // 2. Validate required fields
    const resolvedCompanyName = String(data.company_name || data.name || '').trim();
    if (!resolvedCompanyName) {
      return {
        success: false,
        error: 'Company name is required'
      };
    }
    const fallbackContactPerson = String(
      user.user_metadata?.full_name || user.email || ''
    ).trim();
    const contactPerson = String(data.contact_person || '').trim() || fallbackContactPerson;
    if (!contactPerson) {
      return {
        success: false,
        error: 'Contact person is required'
      };
    }
    if (!data.phone?.trim()) {
      return {
        success: false,
        error: 'Phone number is required'
      };
    }
    if (!data.address?.trim()) {
      return {
        success: false,
        error: 'Address is required'
      };
    }
    const normalizedIndustry = String(data.industry || '').trim();
    if (!normalizedIndustry) {
      return {
        success: false,
        error: 'Industry is required'
      };
    }
    if (!isIndustryOption(normalizedIndustry)) {
      return {
        success: false,
        error: 'Invalid industry selection'
      };
    }
    if (!data.business_type?.trim()) {
      return {
        success: false,
        error: 'Business type is required'
      };
    }

    // 3. Use admin client for database operations
    const admin = getSupabaseAdmin();

    // 4. Check if company already exists for this user
    const { data: existingCompany, error: checkError } = await admin
      .from('companies')
      .select('id, profile_completed')
      .eq('user_id', user.id)
      .maybeSingle();

    if (checkError) {
      console.error('[Company Setup] Error checking existing company:', checkError);
      return {
        success: false,
        error: 'Failed to check existing company',
        details: checkError.message
      };
    }

    // 5. Prepare company data
    const companyData = {
      user_id: user.id,
      company_name: resolvedCompanyName,
      contact_person: contactPerson,
      phone: data.phone.trim(),
      address: data.address.trim(),
      industry: normalizedIndustry,
      business_type: data.business_type.toLowerCase().trim(),
      firm_type: data.firm_type ? data.firm_type.toLowerCase().trim() : null,
      business_category: data.business_category ? data.business_category.toLowerCase().trim() : null,
      gst_number: data.gst_number ? data.gst_number.toUpperCase().trim() : null,
      pan: data.pan ? data.pan.toUpperCase().trim() : null,
      profile_completed: true,
      updated_at: new Date().toISOString(),
    };

    let companyId: string;

    if (existingCompany) {
      // 6a. Update existing company
      const { data: updatedCompany, error: updateError } = await admin
        .from('companies')
        .update(companyData)
        .eq('id', existingCompany.id)
        .select('id')
        .single();

      if (updateError) {
        console.error('[Company Setup] Update error:', updateError);
        return {
          success: false,
          error: 'Failed to update company profile',
          details: updateError.message
        };
      }

      if (!updatedCompany) {
        return {
          success: false,
          error: 'Company update returned no data'
        };
      }

      companyId = updatedCompany.id;
      console.log('[Company Setup] Company updated:', companyId);
    } else {
      // 6b. Insert new company
      const { data: newCompany, error: insertError } = await admin
        .from('companies')
        .insert({
          ...companyData,
          created_at: data.created_at ? new Date(data.created_at) : new Date(),
        })
        .select('id')
        .single();

      if (insertError) {
        // Check for unique constraint violation
        if (insertError.code === '23505' || insertError.message?.includes('unique') || insertError.message?.includes('duplicate')) {
          console.error('[Company Setup] Duplicate company detected:', insertError);
          return {
            success: false,
            error: 'Company already exists for this user',
            details: 'A company profile already exists. Please refresh the page.'
          };
        }

        console.error('[Company Setup] Insert error:', insertError);
        return {
          success: false,
          error: 'Failed to create company profile',
          details: insertError.message
        };
      }

      if (!newCompany) {
        return {
          success: false,
          error: 'Company creation returned no data'
        };
      }

      companyId = newCompany.id;
      console.log('[Company Setup] Company created:', companyId);
    }

    // 9. Revalidate dashboard paths
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/company-setup');

    return {
      success: true,
      companyId,
      message: existingCompany ? 'Company profile updated successfully' : 'Company profile created successfully'
    };

  } catch (error: any) {
    console.error('[Company Setup] Unexpected error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
      details: error?.message || String(error)
    };
  }
}

import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from '@/lib/billing/userSubscriptionAuth';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const owner = await requireOwnerContext();
    if (!owner.ok) return owner.response;

    const body = await req.json().catch(() => ({}));
    const { company_name, phone, pan, gst_number, address } = body ?? {};

    const { data: company, error: companyError } = await owner.supabase
      .from('companies')
      .select('id, company_name, phone, pan, gst_number, address')
      .eq('id', owner.companyId)
      .maybeSingle();

    if (companyError || !company) {
      return apiJson(
        { error: 'Company not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (company_name !== undefined) {
      updateData.company_name = normalizeOptionalString(company_name);
    }

    if (phone !== undefined) {
      updateData.phone = normalizeOptionalString(phone);
    }

    if (pan !== undefined) {
      const normalizedPan = normalizeOptionalString(pan);
      updateData.pan = normalizedPan ? normalizedPan.toUpperCase() : null;
    }

    if (gst_number !== undefined) {
      const normalizedGst = normalizeOptionalString(gst_number);
      updateData.gst_number = normalizedGst ? normalizedGst.toUpperCase() : null;
    }

    if (address !== undefined) {
      updateData.address = normalizeOptionalString(address);
    }

    const { data: updatedCompany, error: updateError } = await owner.supabase
      .from('companies')
      .update(updateData)
      .eq('id', owner.companyId)
      .select('id, company_name, phone, pan, gst_number, address, user_id')
      .single();

    if (updateError) {
      console.error('Company update error:', updateError);
      return apiJson(
        { error: 'Failed to update company profile' },
        { status: 500 }
      );
    }

    try {
      await writeAuditLog({
        companyId: owner.companyId,
        actor: owner.userId,
        action: 'COMPANY_PROFILE_UPDATED',
        status: 'success',
        metadata: {
          before: {
            company_name: company.company_name,
            phone: company.phone,
            pan: company.pan,
            gst_number: company.gst_number,
            address: company.address,
          },
          after: {
            company_name: updatedCompany.company_name,
            phone: updatedCompany.phone,
            pan: updatedCompany.pan,
            gst_number: updatedCompany.gst_number,
            address: updatedCompany.address,
          },
        },
      });
    } catch (auditError) {
      console.error('Failed to write company profile update audit log:', auditError);
    }

    return apiJson({
      success: true,
      message: 'Company profile updated successfully',
      company: {
        id: updatedCompany.id,
        company_name: updatedCompany.company_name,
        phone: updatedCompany.phone,
        pan: updatedCompany.pan,
        gst_number: updatedCompany.gst_number,
        address: updatedCompany.address,
        user_id: updatedCompany.user_id,
      },
    });
  } catch (error: any) {
    console.error('Update company profile error:', error);
    return apiJson(
      { error: error.message || 'Failed to update company profile' },
      { status: 500 }
    );
  }
}

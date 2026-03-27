import { apiJson } from '@/lib/api/response';
import { requireOwnerContext } from '@/lib/billing/userSubscriptionAuth';
import { writeAuditLog } from '@/lib/audit';

const ALLOWED_MODES = new Set(['unit', 'sscc', 'both']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const { data, error } = await owner.supabase
    .from('companies')
    .select('erp_ingestion_mode')
    .eq('id', owner.companyId)
    .maybeSingle();

  if (error) {
    return apiJson(
      { error: 'Failed to load ERP ingestion mode' },
      { status: 500 }
    );
  }

  return apiJson({
    ingestion_mode: data?.erp_ingestion_mode ?? null,
  });
}

export async function POST(req: Request) {
  const owner = await requireOwnerContext();
  if (!owner.ok) return owner.response;

  const body = await req.json().catch(() => ({}));
  const requestedMode = typeof body?.ingestion_mode === 'string' ? body.ingestion_mode.trim().toLowerCase() : '';

  if (!ALLOWED_MODES.has(requestedMode)) {
    return apiJson(
      { error: 'Invalid ERP ingestion mode', code: 'invalid_ingestion_mode' },
      { status: 400 }
    );
  }

  const { data: current, error: readError } = await owner.supabase
    .from('companies')
    .select('erp_ingestion_mode')
    .eq('id', owner.companyId)
    .maybeSingle();

  if (readError) {
    return apiJson(
      { error: 'Failed to load current ERP ingestion mode' },
      { status: 500 }
    );
  }

  const previousMode = current?.erp_ingestion_mode ?? null;

  const { error: updateError } = await owner.supabase
    .from('companies')
    .update({ erp_ingestion_mode: requestedMode })
    .eq('id', owner.companyId);

  if (updateError) {
    return apiJson(
      { error: 'Failed to update ERP ingestion mode' },
      { status: 500 }
    );
  }

  try {
    await writeAuditLog({
      companyId: owner.companyId,
      actor: owner.userId,
      action: 'ERP_INGESTION_MODE_UPDATED',
      status: 'success',
      integrationSystem: 'ERP',
      metadata: {
        previous_mode: previousMode,
        next_mode: requestedMode,
      },
    });
  } catch (auditError) {
    console.error('Failed to write ERP ingestion mode audit log:', auditError);
  }

  return apiJson({
    success: true,
    ingestion_mode: requestedMode,
  });
}

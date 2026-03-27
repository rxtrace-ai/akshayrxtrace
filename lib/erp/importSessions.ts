import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logInfo, logWarn } from '@/lib/observability';

type ImportType = 'unit' | 'sscc';
type ImportStatus = 'processing' | 'completed' | 'failed';

type SessionRow = {
  id: string;
  request_hash: string;
  status: ImportStatus;
  response_status: number;
  error_message: string | null;
  result_json: any;
};

export class ErpImportIdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpImportIdempotencyError';
  }
}

export function computeErpImportRequestHash(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export async function beginErpImportSession(params: {
  supabase: SupabaseClient;
  companyId: string;
  actor: string;
  importType: ImportType;
  idempotencyKey: string;
  requestHash: string;
  totalRows: number;
}): Promise<
  | { mode: 'new'; sessionId: string }
  | { mode: 'replay'; sessionId: string; responseStatus: number; result: any }
  | { mode: 'in_progress'; sessionId: string }
> {
  const { supabase, companyId, actor, importType, idempotencyKey, requestHash, totalRows } = params;

  const { data: existing, error: existingError } = await supabase
    .from('erp_import_sessions')
    .select('id, request_hash, status, response_status, error_message, result_json')
    .eq('company_id', companyId)
    .eq('import_type', importType)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingSession = existing as SessionRow | null;
  if (existingSession) {
    if (existingSession.request_hash !== requestHash) {
      throw new ErpImportIdempotencyError('Idempotency key was already used with a different ERP import payload');
    }

    if (existingSession.status === 'processing') {
      logWarn('ERP_IMPORT_SESSION_IN_PROGRESS_REPLAY', {
        operation: 'erp_import_session',
        companyId,
        userId: actor,
        import_type: importType,
        session_id: existingSession.id,
        idempotency_key: idempotencyKey,
      });
      return { mode: 'in_progress', sessionId: existingSession.id };
    }

    logInfo('ERP_IMPORT_SESSION_REPLAY', {
      operation: 'erp_import_session',
      companyId,
      userId: actor,
      import_type: importType,
      session_id: existingSession.id,
      idempotency_key: idempotencyKey,
      status: existingSession.status,
    });
    return {
      mode: 'replay',
      sessionId: existingSession.id,
      responseStatus: existingSession.response_status || 200,
      result: existingSession.result_json ?? {
        success: existingSession.status === 'completed',
        error: existingSession.error_message || 'ERP import replay unavailable',
      },
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('erp_import_sessions')
    .insert({
      company_id: companyId,
      actor,
      import_type: importType,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      status: 'processing',
      total_rows: totalRows,
      response_status: 202,
    })
    .select('id')
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message || 'Failed to create ERP import session');
  }

  logInfo('ERP_IMPORT_SESSION_STARTED', {
    operation: 'erp_import_session',
    companyId,
    userId: actor,
    import_type: importType,
    session_id: inserted.id,
    idempotency_key: idempotencyKey,
    total_rows: totalRows,
  });

  return { mode: 'new', sessionId: inserted.id as string };
}

export async function completeErpImportSession(params: {
  supabase: SupabaseClient;
  sessionId: string;
  status: Exclude<ImportStatus, 'processing'>;
  responseStatus: number;
  result: any;
  summary: {
    validated: number;
    imported: number;
    duplicates: number;
    skipped: number;
    invalid: number;
  };
  errorMessage?: string | null;
}): Promise<void> {
  const { supabase, sessionId, status, responseStatus, result, summary, errorMessage } = params;
  const { error } = await supabase
    .from('erp_import_sessions')
    .update({
      status,
      response_status: responseStatus,
      result_json: result,
      error_message: errorMessage ?? null,
      validated_rows: summary.validated,
      imported_rows: summary.imported,
      duplicate_rows: summary.duplicates,
      skipped_rows: summary.skipped,
      invalid_rows: summary.invalid,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    throw new Error(error.message);
  }

  logInfo('ERP_IMPORT_SESSION_COMPLETED', {
    operation: 'erp_import_session',
    session_id: sessionId,
    status,
    response_status: responseStatus,
    validated_rows: summary.validated,
    imported_rows: summary.imported,
    duplicate_rows: summary.duplicates,
    skipped_rows: summary.skipped,
    invalid_rows: summary.invalid,
  });
}

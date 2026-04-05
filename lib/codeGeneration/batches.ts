import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type BatchFamily = "UNIT" | "SSCC";
type BatchSource = "MANUAL" | "CSV" | "ERP" | "API";
type BatchStatus = "PENDING" | "SUCCESS" | "PARTIAL_FAILED" | "FAILED";
type BatchSymbolType = "QR" | "DATAMATRIX" | null;
type BatchCodeMode = "GS1" | "PIC" | null;

export type CreateCodeGenerationBatchParams = {
  companyId: string;
  generationFamily: BatchFamily;
  source?: BatchSource;
  unitSkuMasterId?: string | null;
  skuId?: string | null;
  skuCodeSnapshot: string;
  gtinSnapshot?: string | null;
  productBatchSnapshot?: string | null;
  codeMode?: BatchCodeMode;
  symbolType?: BatchSymbolType;
  requestedQty: number;
  requestId?: string | null;
  createdBy?: string | null;
  meta?: Record<string, unknown>;
};

export type UpdateCodeGenerationBatchParams = {
  batchId: string;
  status: BatchStatus;
  generatedQty?: number;
  failedQty?: number;
  meta?: Record<string, unknown>;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function createGenerationBatchNo(family: BatchFamily) {
  const now = new Date();
  const datePart = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${family}-${datePart}-${suffix}`;
}

export async function createCodeGenerationBatch(params: CreateCodeGenerationBatchParams) {
  const supabase = getSupabaseAdmin();
  const requestId = typeof params.requestId === "string" && params.requestId.trim() ? params.requestId.trim() : null;

  if (requestId) {
    const { data: existing, error: existingError } = await supabase
      .from("code_generation_batches")
      .select("id, batch_no")
      .eq("company_id", params.companyId)
      .eq("request_id", requestId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return {
        id: String(existing.id),
        batchNo: String(existing.batch_no),
      };
    }
  }

  const payload = {
    company_id: params.companyId,
    batch_no: createGenerationBatchNo(params.generationFamily),
    generation_family: params.generationFamily,
    source: params.source || "MANUAL",
    status: "PENDING" as BatchStatus,
    unit_sku_master_id: params.unitSkuMasterId ?? null,
    sku_id: params.skuId ?? null,
    sku_code_snapshot: params.skuCodeSnapshot,
    gtin_snapshot: params.gtinSnapshot ?? null,
    product_batch_snapshot: params.productBatchSnapshot ?? null,
    code_mode: params.codeMode ?? null,
    symbol_type: params.symbolType ?? null,
    requested_qty: params.requestedQty,
    generated_qty: 0,
    failed_qty: 0,
    request_id: requestId,
    created_by: params.createdBy ?? null,
    meta: params.meta ?? {},
  };

  const { data, error } = await supabase
    .from("code_generation_batches")
    .insert(payload)
    .select("id, batch_no")
    .single();

  if (error) {
    const isUniqueViolation =
      error.code === "23505" || String(error.message || "").toLowerCase().includes("unique");
    if (isUniqueViolation && requestId) {
      const { data: existing, error: existingError } = await supabase
        .from("code_generation_batches")
        .select("id, batch_no")
        .eq("company_id", params.companyId)
        .eq("request_id", requestId)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existing) {
        return {
          id: String(existing.id),
          batchNo: String(existing.batch_no),
        };
      }
    }
    throw new Error(error.message);
  }

  return {
    id: String(data.id),
    batchNo: String(data.batch_no),
  };
}

export async function updateCodeGenerationBatch(params: UpdateCodeGenerationBatchParams) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("code_generation_batches")
    .select("status, meta")
    .eq("id", params.batchId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    throw new Error("Code generation batch not found");
  }

  const currentStatus = String(existing.status || "");
  const nextStatus =
    currentStatus === "SUCCESS" && params.status === "FAILED"
      ? currentStatus
      : params.status;
  const mergedMeta =
    params.meta
      ? {
          ...((existing.meta as Record<string, unknown> | null) || {}),
          ...params.meta,
        }
      : existing.meta;

  const patch: Record<string, unknown> = {
    status: nextStatus,
    meta: mergedMeta,
  };

  if (typeof params.generatedQty === "number") {
    patch.generated_qty = params.generatedQty;
  }
  if (typeof params.failedQty === "number") {
    patch.failed_qty = params.failedQty;
  }
  const { error } = await supabase
    .from("code_generation_batches")
    .update(patch)
    .eq("id", params.batchId);

  if (error) {
    throw new Error(error.message);
  }
}

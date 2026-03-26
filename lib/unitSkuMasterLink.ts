import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeBatch, normalizeDateInput, normalizeOptionalMrp, normalizeSkuCode } from "@/lib/unitSkuMaster";

function applyNullableMatch<T extends { eq: Function; is: Function }>(
  query: T,
  column: string,
  value: string | null
) {
  return value == null ? query.is(column, null) : query.eq(column, value);
}

export async function resolveLegacySkuIdForCode(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  companyId: string,
  skuCode: string
): Promise<string | null> {
  const normalizedSkuCode = normalizeSkuCode(skuCode).toUpperCase();
  if (!normalizedSkuCode) return null;

  const { data, error } = await supabase
    .from("skus")
    .select("id")
    .eq("company_id", companyId)
    .eq("sku_code", normalizedSkuCode)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function resolveExactUnitSkuMasterId(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  skuCode: string;
  batch: string;
  expiry: string;
  mfd?: string | null;
  mrp?: string | null;
}): Promise<string | null> {
  const normalizedSkuCode = normalizeSkuCode(opts.skuCode);
  const normalizedBatch = normalizeBatch(opts.batch);
  const normalizedExpiry = normalizeDateInput(opts.expiry);
  const normalizedMfd = normalizeDateInput(opts.mfd);
  const normalizedMrp = normalizeOptionalMrp(opts.mrp);

  if (!normalizedSkuCode || !normalizedBatch || !normalizedExpiry) {
    return null;
  }

  let query = opts.supabase
    .from("unit_sku_master")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("sku_code", normalizedSkuCode)
    .eq("batch", normalizedBatch)
    .eq("expiry", normalizedExpiry)
    .is("deleted_at", null);

  query = applyNullableMatch(query, "mfd", normalizedMfd);
  query = applyNullableMatch(query, "mrp", normalizedMrp);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function resolveSsccUnitSkuMasterId(opts: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  skuCode: string;
  batch?: string | null;
}): Promise<string | null> {
  const normalizedSkuCode = normalizeSkuCode(opts.skuCode);
  const normalizedBatch = normalizeBatch(opts.batch);

  if (!normalizedSkuCode) return null;

  let query = opts.supabase
    .from("unit_sku_master")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("sku_code", normalizedSkuCode)
    .not("gtin", "is", null)
    .neq("gtin", "")
    .is("deleted_at", null);

  if (normalizedBatch) {
    query = query.eq("batch", normalizedBatch);
  }

  const { data, error } = await query.limit(2);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length !== 1) return null;
  return data[0]?.id ?? null;
}

export type UnitSkuMasterRecord = {
  id: string;
  company_id: string;
  sku_code: string;
  gtin: string | null;
  batch: string;
  expiry: string;
  mfd: string | null;
  mrp: string | null;
  created_at: string;
  deleted_at?: string | null;
};

export type UnitSkuMasterInput = {
  sku_code: unknown;
  gtin?: unknown;
  batch: unknown;
  expiry: unknown;
  mfd?: unknown;
  mrp?: unknown;
};

export type UnitSkuValidationResult =
  | {
      ok: true;
      value: {
        sku_code: string;
        gtin: string | null;
        batch: string;
        expiry: string;
        mfd: string | null;
        mrp: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    };

function normalizeText(value: unknown, options?: { uppercase?: boolean; maxLen?: number }) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const next = options?.uppercase ? raw.toUpperCase() : raw;
  if (options?.maxLen && next.length > options.maxLen) {
    throw new Error(`Value exceeds maximum length of ${options.maxLen}`);
  }
  return next;
}

export function normalizeSkuCode(value: unknown) {
  return normalizeText(value, { maxLen: 200 });
}

export function normalizeBatch(value: unknown) {
  return normalizeText(value, { maxLen: 100 });
}

export function normalizeOptionalGtin(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw;
}

export function normalizeDateInput(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) {
    const yy = raw.slice(0, 2);
    const mm = raw.slice(2, 4);
    const dd = raw.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }
  if (/^\d{8}$/.test(raw)) {
    const dd = raw.slice(0, 2);
    const mm = raw.slice(2, 4);
    const yyyy = raw.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

export function normalizeOptionalMrp(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,\-]/g, "");
  if (!/[0-9]/.test(cleaned)) {
    throw new Error("MRP must contain digits");
  }
  let normalized = cleaned;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;
  if (dotCount > 0 && commaCount > 0) {
    normalized =
      cleaned.lastIndexOf(".") > cleaned.lastIndexOf(",")
        ? cleaned.replace(/,/g, "")
        : cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else if (commaCount > 0 && dotCount === 0) {
    const parts = cleaned.split(",");
    normalized = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : cleaned.replace(/,/g, "");
  } else if (dotCount > 1) {
    normalized = cleaned.replace(/\./g, "");
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("MRP must be a valid positive number");
  }
  return num.toFixed(2);
}

export async function validateUnitSkuMasterInput(input: UnitSkuMasterInput): Promise<UnitSkuValidationResult> {
  try {
    const sku_code = normalizeSkuCode(input.sku_code);
    const batch = normalizeBatch(input.batch);
    const expiry = normalizeDateInput(input.expiry);
    const mfd = normalizeDateInput(input.mfd);
    const mrp = normalizeOptionalMrp(input.mrp);
    let gtin = normalizeOptionalGtin(input.gtin);

    if (!sku_code) {
      return { ok: false, error: "sku_code is required" };
    }
    if (!batch) {
      return { ok: false, error: "batch is required" };
    }
    if (!expiry) {
      return { ok: false, error: "expiry must be YYYY-MM-DD, YYMMDD, or DDMMYYYY" };
    }

    if (gtin) {
      const { validateGTIN } = await import("@/lib/gs1/gtin");
      const validation = validateGTIN(gtin);
      if (!validation.valid || !validation.normalized) {
        return { ok: false, error: validation.error || "Invalid GTIN" };
      }
      gtin = validation.normalized;
    }

    return {
      ok: true,
      value: {
        sku_code,
        gtin,
        batch,
        expiry,
        mfd,
        mrp,
      },
    };
  } catch (error: any) {
    return { ok: false, error: error?.message || "Invalid SKU Master input" };
  }
}

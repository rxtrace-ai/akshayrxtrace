/**
 * CANONICAL GS1 GENERATION FUNCTION
 * 
 * This is the single source of truth for GS1 code generation in RxTrace.
 * All APIs must use this function to ensure consistency and compliance.
 * 
 * GS1 Requirements:
 * - Mandatory AIs: (01) GTIN, (17) Expiry, (10) Batch, (21) Serial
 * - Optional AIs: (11) Mfg Date, (91) MRP, (92) SKU
 * - Machine format (no parentheses) with FNC1 separators
 * - Fixed-length AIs: 01 (14), 17 (6), 11 (6)
 * - Variable-length AIs: 10, 21, 91, 92 (terminated with FNC1)
 * 
 * Format: 01GTIN17YYMMDD10BATCH<FNC1>21SERIAL<FNC1>[11MFG<FNC1>][91MRP<FNC1>][92SKU]
 */

const FNC1 = String.fromCharCode(29); // ASCII Group Separator (GS)

// Maximum lengths for variable-length AIs (per GS1 spec and practical limits)
const MAX_LENGTHS = {
  batch: 20,    // AI 10 - Batch/Lot number
  serial: 20,   // AI 21 - Serial number
  mrp: 20,      // AI 91 - MRP (internal)
  sku: 20,      // AI 92 - SKU (internal)
} as const;

/**
 * Normalize GTIN to 14 digits and validate check digit
 * 
 * Uses shared GTIN helper for consistency.
 */
function normalizeAndValidateGTIN(gtin: string): string {
  // Import synchronously at module level would cause issues, so we use dynamic import
  // For now, we'll use the inline implementation to keep it synchronous
  // This matches the shared helper logic exactly
  const digits = gtin.replace(/\D/g, '');
  
  if (digits.length < 8 || digits.length > 14) {
    throw new Error(`Invalid GTIN. Please verify the number or GTIN source. GTIN must be 8-14 digits (GTIN-8, GTIN-12, GTIN-13, or GTIN-14).`);
  }
  
  // Pad to 14 digits (left-pad with zeros) - NEVER strip leading zeros
  const gtin14 = digits.padStart(14, '0');
  
  // Validate check digit using GS1 Mod-10 algorithm
  const checkDigit = parseInt(gtin14[13], 10);
  const base = gtin14.slice(0, 13);
  
  let sum = 0;
  let multiplier = 3;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += parseInt(base[i], 10) * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }
  
  const calculatedCheckDigit = (10 - (sum % 10)) % 10;
  if (calculatedCheckDigit !== checkDigit) {
    throw new Error(`Invalid GTIN. Please verify the number or GTIN source. The GTIN check digit is incorrect.`);
  }
  
  return gtin14;
}

/**
 * Format date to YYMMDD format
 */
function formatDateYYMMDD(date: string | Date): string {
  const dt = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dt.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  
  const yy = String(dt.getFullYear()).slice(-2);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  
  return `${yy}${mm}${dd}`;
}

/**
 * Normalize MRP to rupees with two decimals
 */
function normalizeMRP(raw: string | number): string {
  if (typeof raw === "number") {
    return raw.toFixed(2);
  }
  
  let s = raw.trim();
  s = s.replace(/[^\d.,\-]/g, "");
  
  if (!/[0-9]/.test(s)) {
    throw new Error(`Invalid MRP format: ${raw}`);
  }
  
  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;
  
  let value = s;
  
  if (dotCount > 0 && commaCount > 0) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) {
      value = s.replace(/,/g, "");
    } else {
      value = s.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (commaCount > 0 && dotCount === 0) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      value = parts[0] + "." + parts[1];
    } else {
      value = s.replace(/,/g, "");
    }
  } else if (dotCount > 1) {
    value = s.replace(/\./g, "");
  }
  
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid MRP value: ${raw}`);
  }
  
  return num.toFixed(2);
}

/**
 * Validate and truncate variable-length AI value
 */
function validateVariableLengthAI(value: string, aiName: keyof typeof MAX_LENGTHS, aiCode: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`AI ${aiCode} (${aiName}) is required but was empty`);
  }
  
  const trimmed = value.trim();
  
  if (trimmed.length > MAX_LENGTHS[aiName]) {
    throw new Error(
      `AI ${aiCode} (${aiName}) exceeds maximum length of ${MAX_LENGTHS[aiName]} characters: ${trimmed.length}`
    );
  }
  
  // Check for invalid characters (FNC1 should not be in value)
  if (trimmed.includes(FNC1)) {
    throw new Error(`AI ${aiCode} (${aiName}) contains invalid FNC1 character`);
  }
  
  return trimmed;
}

export interface GS1GenerationParams {
  /** AI (01) - Global Trade Item Number (8-14 digits, will be normalized to 14) */
  gtin: string;
  
  /** AI (17) - Expiration Date (required) */
  expiry: string | Date;
  
  /** AI (11) - Manufacturing Date (optional) */
  mfgDate?: string | Date;
  
  /** AI (10) - Batch/Lot Number (required, max 20 chars) */
  batch: string;
  
  /** AI (21) - Serial Number (required, max 20 chars) */
  serial: string;
  
  /** AI (91) - MRP in rupees (optional, max 20 chars) */
  mrp?: string | number;
  
  /** AI (92) - SKU code (optional, max 20 chars) */
  sku?: string;
}

/**
 * Generate canonical GS1 machine-format payload
 * 
 * Format: 01GTIN17YYMMDD10BATCH<FNC1>21SERIAL<FNC1>[11MFG<FNC1>][91MRP<FNC1>][92SKU]
 * 
 * Order: Fixed-length AIs first (01, 17, 11 when present), then variable-length AIs (10, 21, 91, 92)
 * 
 * @param params - GS1 generation parameters
 * @returns GS1 machine-format string (no parentheses, with FNC1 separators)
 * @throws Error if mandatory fields are missing or invalid
 */
export function generateCanonicalGS1(params: GS1GenerationParams): string {
  // Validate mandatory fields
  if (!params.gtin) {
    throw new Error("GTIN (01) is required");
  }
  if (!params.expiry) {
    throw new Error("Expiry date (17) is required");
  }
  if (!params.batch) {
    throw new Error("Batch number (10) is required");
  }
  if (!params.serial) {
    throw new Error("Serial number (21) is required");
  }
  
  // Normalize and validate GTIN
  const gtin14 = normalizeAndValidateGTIN(params.gtin);
  
  // Format dates
  const expiryYYMMDD = formatDateYYMMDD(params.expiry);
  const mfgYYMMDD = params.mfgDate ? formatDateYYMMDD(params.mfgDate) : null;
  
  // Validate and normalize variable-length AIs
  const batch = validateVariableLengthAI(params.batch, "batch", "10");
  const serial = validateVariableLengthAI(params.serial, "serial", "21");
  
  // Build payload: Fixed-length AIs first
  let payload = `01${gtin14}`;
  payload += `17${expiryYYMMDD}`;

  // Variable-length AIs with FNC1 termination
  payload += `10${batch}${FNC1}`;
  payload += `21${serial}${FNC1}`;

  if (mfgYYMMDD) {
    payload += `11${mfgYYMMDD}${FNC1}`;
  }
  
  // Optional internal AIs
  if (params.mrp !== undefined) {
    const mrp = normalizeMRP(params.mrp);
    const mrpValidated = validateVariableLengthAI(mrp, "mrp", "91");
    payload += `91${mrpValidated}${FNC1}`;
  }
  
  if (params.sku) {
    const sku = validateVariableLengthAI(params.sku, "sku", "92");
    payload += `92${sku}${FNC1}`;
  }
  
  // Remove trailing FNC1 (last AI doesn't need it)
  if (payload.endsWith(FNC1)) {
    payload = payload.slice(0, -1);
  }
  
  return payload;
}

/**
 * Normalize GS1 payload to canonical format for comparison
 * Removes parentheses, normalizes FNC1, and standardizes format
 */
export function normalizeGS1Payload(payload: string): string {
  if (!payload) return "";
  
  // Remove parentheses (human-readable format)
  let normalized = payload.replace(/[()]/g, "");
  
  // Normalize FNC1/GS characters (some scanners may use different encodings)
  normalized = normalized.replace(/[\u001D\u00F1]/g, FNC1);
  
  // Remove any whitespace
  normalized = normalized.replace(/\s/g, "");
  
  return normalized;
}

/**
 * Compare two GS1 payloads (handles format differences)
 */
export function compareGS1Payloads(stored: string, scanned: string): boolean {
  const normalizedStored = normalizeGS1Payload(stored);
  const normalizedScanned = normalizeGS1Payload(scanned);
  
  return normalizedStored === normalizedScanned;
}

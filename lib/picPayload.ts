const FNC1 = String.fromCharCode(29);

export type PicUnitFields = {
  sku: string;
  batch: string;
  expiryYYMMDD: string;
  serial: string;
  mfgYYMMDD?: string;
  mrp?: string;
};

function requireNoFnc1(value: string, field: string) {
  if (value.includes(FNC1)) throw new Error(`Invalid ${field}: contains FNC1`);
}

function validateAI(ai: string) {
  if (!/^\d{2}$/.test(ai)) throw new Error(`Invalid AI: ${ai}`);
  const n = Number(ai);
  if (!Number.isInteger(n) || n < 91 || n > 99) {
    throw new Error(`Invalid PIC AI: ${ai}. Only AI 91-99 allowed.`);
  }
}

function validateValue(value: string, field: string) {
  const v = value.trim();
  if (!v) throw new Error(`${field} is required`);
  if (v.length > 40) throw new Error(`${field} too long (max 40 chars)`);
  requireNoFnc1(v, field);
  return v;
}

/**
 * PIC payload (internal mode): uses only AIs 91-99.
 *
 * Mapping for unit-level codes:
 * - 91: SKU
 * - 92: Batch
 * - 93: Expiry (YYMMDD)
 * - 94: MFG (YYMMDD) [optional]
 * - 95: Serial
 * - 96: MRP [optional]
 *
 * Machine format with FNC1 separators between variable fields.
 */
export function buildPicUnitPayload(fields: PicUnitFields): string {
  const sku = validateValue(fields.sku, "SKU");
  const batch = validateValue(fields.batch, "Batch");
  const expiry = validateValue(fields.expiryYYMMDD, "Expiry (YYMMDD)");
  const serial = validateValue(fields.serial, "Serial");

  if (!/^\d{6}$/.test(expiry)) {
    throw new Error("Expiry must be YYMMDD for PIC payload");
  }

  let payload = "";

  const parts: Array<[string, string]> = [
    ["91", sku],
    ["92", batch],
    ["93", expiry],
    ...(fields.mfgYYMMDD ? [["94", validateValue(fields.mfgYYMMDD, "MFG (YYMMDD)")] as [string, string]] : []),
    ["95", serial],
    ...(fields.mrp ? [["96", validateValue(fields.mrp, "MRP")] as [string, string]] : []),
  ];

  for (const [ai, value] of parts) {
    validateAI(ai);
    payload += `${ai}${value}${FNC1}`;
  }

  return payload.slice(0, -1); // drop trailing FNC1
}


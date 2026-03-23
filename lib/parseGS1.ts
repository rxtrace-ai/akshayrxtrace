// lib/parseGS1.ts

/**
 * Parsed GS1 barcode data interface
 * Contains extracted Application Identifier (AI) fields from GS1 barcodes
 */
export interface GS1Data {
  /** AI (01) - Global Trade Item Number (14 digits) */
  gtin?: string;
  
  /** AI (17) - Expiration Date in DD-MM-YYYY format (converted from YYMMDD) */
  expiryDate?: string;
  
  /** AI (10) - Batch/Lot Number (variable length) */
  batchNo?: string;
  
  /** AI (11) - Manufacturing/Production Date in DD-MM-YYYY format (converted from YYMMDD) */
  mfgDate?: string;
  
  /** AI (21) - Serial Number (variable length) */
  serialNo?: string;

  /** AI (00) - SSCC (Serial Shipping Container Code) for boxes/cartons/pallets */
  sscc?: string;

  /** Unit Identifier (UID) for individual units */
  uid?: string;

  /** AI (91) - Internal: MRP (company-specific) */
  mrp?: string;

  /** AI (92) - Internal: SKU / Product name (company-specific) */
  skuName?: string;
  
  /** Original scanned barcode data before parsing */
  raw: string;
  
  /** Whether the GS1 parsing was successful */
  parsed: boolean;
}

/**
 * Parse GS1-compliant barcode data and extract Application Identifier (AI) fields
 * 
 * Supports two input formats:
 * 1. Barcode format (without parentheses): `01GTIN17YYMMDD10BATCH<GS>11YYMMDD91MRP<GS>92SKU<GS>21SERIAL<GS>`
 * 2. Human-readable format (with parentheses): `(01)GTIN(17)YYMMDD(10)BATCH(11)YYMMDD(91)MRP(92)SKU(21)SERIAL`
 * 
 * Handles GS1 standards:
 * - Fixed-length fields (GTIN, dates)
 * - Variable-length fields with GS (Group Separator, ASCII 29) delimiters
 * - FNC1 character removal
 * 
 * @param data - Raw GS1 barcode string from scanner
 * @returns Parsed GS1 data object with extracted fields
 */
export function parseGS1(data: string): GS1Data {
  const result: GS1Data = {
    raw: data,
    parsed: false,
  };

  if (!data) {
    return result;
  }

  // Remove any FNC1 characters that might be at the start
  // FNC1 is often encoded as ASCII 0x1D or a special symbol; scanners may map it differently.
  let cleanData = data.replace(/^[\u00F1\xF1]/, '');
  
  // Check if data has parentheses (display format) or not (barcode format)
  const hasParentheses =
    cleanData.includes('(01)') ||
    cleanData.includes('(10)') ||
    cleanData.includes('(17)') ||
    cleanData.includes('(91)') ||
    cleanData.includes('(92)') ||
    false;

  if (hasParentheses) {
    // Format with parentheses: (01)12345(17)250101(10)BATCH(11)241201(91)MRP(92)SKU
    return parseGS1WithParentheses(cleanData);
  } else {
    // Format without parentheses: 01123456789012341725010110BATCH<GS>1124120191MRP<GS>92SKU<GS>
    return parseGS1WithoutParentheses(cleanData);
  }
}

/**
 * Parse GS1 data in human-readable format (with parentheses)
 * Format: (01)GTIN(17)YYMMDD(10)BATCH(11)YYMMDD(91)MRP(92)SKU
 * 
 * @param data - GS1 string with parentheses around Application Identifiers
 * @returns Parsed GS1 data object
 * @internal
 */
function parseGS1WithParentheses(data: string): GS1Data {
  const result: GS1Data = {
    raw: data,
    parsed: true,
  };

  // (00) SSCC - 18 digits (Serial Shipping Container Code)
  const ssccMatch = data.match(/\(00\)(\d{18})/);
  if (ssccMatch) {
    result.sscc = ssccMatch[1];
  }

  // (01) GTIN - 14 digits
  const gtinMatch = data.match(/\(01\)(\d{14})/);
  if (gtinMatch) {
    result.gtin = gtinMatch[1];
  }

  // (17) Expiry Date - 6 digits YYMMDD
  const expiryMatch = data.match(/\(17\)(\d{6})/);
  if (expiryMatch) {
    const yymmdd = expiryMatch[1];
    result.expiryDate = formatGS1Date(yymmdd);
  }

  // (10) Batch/Lot Number - variable length (up to next "(" or end)
  const batchMatch = data.match(/\(10\)([^\(]+)/);
  if (batchMatch) {
    result.batchNo = batchMatch[1].trim();
  }

  // (11) MFG Date - 6 digits YYMMDD
  const mfgMatch = data.match(/\(11\)(\d{6})/);
  if (mfgMatch) {
    const yymmdd = mfgMatch[1];
    result.mfgDate = formatGS1Date(yymmdd);
  }

  // (21) Serial Number - variable length
  const serialMatch = data.match(/\(21\)([^\(]+)/);
  if (serialMatch) {
    result.serialNo = serialMatch[1].trim();
  }

  // (91) MRP - variable length (internal use)
  const mrpMatch = data.match(/\(91\)([^\(]+)/);
  if (mrpMatch) {
    result.mrp = mrpMatch[1].trim();
  }

  // (92) SKU / Product Name - variable length (internal use)
  const skuMatch = data.match(/\(92\)([^\(]+)/);
  if (skuMatch) {
    result.skuName = skuMatch[1].trim();
  }

  return result;
}

/**
 * Parse GS1 data in barcode format (without parentheses)
 * Format: 
 *   01GTIN17YYMMDD11YYMMDD10BATCH<GS>21SERIAL<GS>91MRP<GS>92SKU<GS>
 * 
 * Uses sequential parsing with 2-digit Application Identifiers:
 * - Fixed-length AIs: Read exact number of characters
 * - Variable-length AIs: Read until GS (Group Separator, ASCII 29) or next AI
 * 
 * @param data - GS1 string without parentheses (raw barcode data)
 * @returns Parsed GS1 data object
 * @internal
 */
function parseGS1WithoutParentheses(data: string): GS1Data {
  const result: GS1Data = {
    raw: data,
    parsed: true,
  };

  let position = 0;
  const GS = String.fromCharCode(29); // Group Separator

  while (position < data.length) {
    // Read AI (2 digits)
    const ai = data.substring(position, position + 2);
    position += 2;

    switch (ai) {
      case '00': { // SSCC - 18 digits (fixed length) - Serial Shipping Container Code
        result.sscc = data.substring(position, position + 18);
        position += 18;
        break;
      }

      case '01': { // GTIN - 14 digits (fixed length)
        result.gtin = data.substring(position, position + 14);
        position += 14;
        break;
      }

      case '17': { // Expiry Date - 6 digits YYMMDD (fixed length)
        const expiryYYMMDD = data.substring(position, position + 6);
        result.expiryDate = formatGS1Date(expiryYYMMDD);
        position += 6;
        break;
      }

      case '11': { // MFG Date - 6 digits YYMMDD (fixed length)
        const mfgYYMMDD = data.substring(position, position + 6);
        result.mfgDate = formatGS1Date(mfgYYMMDD);
        position += 6;
        break;
      }

      case '10': { // Batch Number - variable length (ends with GS or next AI)
        const batchEnd = data.indexOf(GS, position);
        if (batchEnd !== -1) {
          result.batchNo = data.substring(position, batchEnd);
          position = batchEnd + 1; // Skip GS character
        } else {
          const nextAI = findNextAI(data, position);
          if (nextAI !== -1) {
            result.batchNo = data.substring(position, nextAI);
            position = nextAI;
          } else {
            result.batchNo = data.substring(position);
            position = data.length;
          }
        }
        break;
      }

      case '21': { // Serial Number - variable length (ends with GS or end)
        const serialEnd = data.indexOf(GS, position);
        if (serialEnd !== -1) {
          result.serialNo = data.substring(position, serialEnd);
          position = serialEnd + 1;
        } else {
          result.serialNo = data.substring(position);
          position = data.length;
        }
        break;
      }

      case '91': { // MRP - variable length (internal use)
        const mrpEnd = data.indexOf(GS, position);
        if (mrpEnd !== -1) {
          result.mrp = data.substring(position, mrpEnd);
          position = mrpEnd + 1;
        } else {
          const nextAI = findNextAI(data, position);
          if (nextAI !== -1) {
            result.mrp = data.substring(position, nextAI);
            position = nextAI;
          } else {
            result.mrp = data.substring(position);
            position = data.length;
          }
        }
        break;
      }

      case '92': { // SKU / Product name - variable length (internal use)
        const skuEnd = data.indexOf(GS, position);
        if (skuEnd !== -1) {
          result.skuName = data.substring(position, skuEnd);
          position = skuEnd + 1;
        } else {
          const nextAI = findNextAI(data, position);
          if (nextAI !== -1) {
            result.skuName = data.substring(position, nextAI);
            position = nextAI;
          } else {
            result.skuName = data.substring(position);
            position = data.length;
          }
        }
        break;
      }

      default:
        // Unknown AI, stop parsing to avoid garbage
        position = data.length;
        break;
    }
  }

  return result;
}

/**
 * Find the position of the next GS1 Application Identifier in the data string
 * 
 * Application Identifiers are:
 * - Always 2 digits in this implementation
 * - Commonly: 01, 10, 11, 17, 21, 30, 37, 91, 92, etc.
 * 
 * @param data - GS1 data string
 * @param startPos - Position to start searching from
 * @returns Position of next AI, or -1 if not found
 * @internal
 */
function findNextAI(data: string, startPos: number): number {
  const knownAIs = ['01', '10', '11', '17', '21', '30', '37', '91', '92'];

  for (let i = startPos; i < data.length - 1; i++) {
    const twoChars = data.substring(i, i + 2);
    if (/^\d{2}$/.test(twoChars) && knownAIs.includes(twoChars)) {
      return i;
    }
  }
  return -1;
}

/**
 * Convert GS1 date format (YYMMDD) to strict ISO format (YYYY-MM-DD)
 * 
 * GS1 dates are encoded as 6 digits: YYMMDD
 * - YY: Two-digit year (00-49 = 2000-2049, 50-99 = 1950-1999)
 * - MM: Month (01-12)
 * - DD: Day (01-31)
 * 
 * @param yymmdd - GS1 date string in YYMMDD format (6 digits)
 * @returns Formatted date string in YYYY-MM-DD format
 * @internal
 */
function formatGS1Date(yymmdd: string): string {
  if (yymmdd.length !== 6) {
    return yymmdd;
  }

  const yy = yymmdd.substring(0, 2);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);

  const yyyy = `20${yy}`;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format parsed GS1 data into a human-readable display string
 * 
 * Combines all extracted GS1 fields into a pipe-separated string
 * suitable for display in scanner apps or verification interfaces
 */
export function formatGS1ForDisplay(data: GS1Data): string {
  if (!data.parsed) {
    return `Raw data: ${data.raw}`;
  }

  const parts: string[] = [];
  
  if (data.skuName)     parts.push(`SKU: ${data.skuName}`);
  if (data.mrp)         parts.push(`MRP: ${data.mrp}`);
  if (data.batchNo)     parts.push(`Batch: ${data.batchNo}`);
  if (data.mfgDate)     parts.push(`MFG: ${data.mfgDate}`);
  if (data.expiryDate)  parts.push(`Expiry: ${data.expiryDate}`);
  if (data.gtin)        parts.push(`GTIN: ${data.gtin}`);
  if (data.serialNo)    parts.push(`Serial: ${data.serialNo}`);

  // This now aligns with what you want to show:
  // Company / SKU / MRP / MFD / Expiry / Batch / GTIN / Serial
  return parts.join(' | ');
}

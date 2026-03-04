import { parseGS1, type GS1Data } from "@/lib/parseGS1";

const GS = String.fromCharCode(29);

export type PayloadMode = "GS1" | "PIC" | "INVALID";

export type PicData = {
  sku?: string; // AI 91
  batch?: string; // AI 92
  expiryYYMMDD?: string; // AI 93
  mfgYYMMDD?: string; // AI 94
  serial?: string; // AI 95
  mrp?: string; // AI 96
  raw: string;
  parsed: boolean;
};

export type ParsedPayload =
  | { mode: "GS1"; parsed: GS1Data }
  | { mode: "PIC"; parsed: PicData }
  | { mode: "INVALID"; error: string; raw: string };

function normalizeRaw(input: string): string {
  return String(input || "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/[\u001D\u00F1]/g, GS) // normalize GS / ñ to ASCII 29
    .replace(/\s+/g, "");
}

function hasAnyAi(input: string, ais: string[]): boolean {
  return ais.some((ai) => input.includes(`(${ai})`) || input.includes(ai));
}

function looksLikeGS1(input: string): boolean {
  // GS1 is considered present if we see AI 00 or 01 patterns (human-readable or machine).
  return (
    input.includes("(00)") ||
    input.includes("(01)") ||
    input.startsWith("00") ||
    input.startsWith("01")
  );
}

function looksLikePICOnly(input: string): boolean {
  // PIC-only means ONLY 91-99 AIs, no GTIN/SSCC/date/batch/serial standard AIs.
  // NOTE: GS1 can legally contain AI 91/92 etc, so we only classify PIC when GS1 signals are absent.
  if (looksLikeGS1(input)) return false;
  // Reject if any GS1 unit/SSCC AIs appear in the string.
  if (hasAnyAi(input, ["00", "01", "10", "11", "17", "21"])) return false;
  // Must contain at least one 91-99 AI marker.
  return (
    /\(9[1-9]\)/.test(input) ||
    /^9[1-9]/.test(input) ||
    input.includes("91") ||
    input.includes("92") ||
    input.includes("93") ||
    input.includes("94") ||
    input.includes("95") ||
    input.includes("96")
  );
}

function parsePIC(input: string): PicData {
  const raw = input;
  const clean = normalizeRaw(input);
  const out: PicData = { raw, parsed: false };
  if (!clean) return out;

  const set = (ai: string, value: string) => {
    const v = value.trim();
    if (!v) return;
    if (ai === "91") out.sku = v;
    if (ai === "92") out.batch = v;
    if (ai === "93") out.expiryYYMMDD = v;
    if (ai === "94") out.mfgYYMMDD = v;
    if (ai === "95") out.serial = v;
    if (ai === "96") out.mrp = v;
  };

  // Parentheses format: (91)SKU(92)BATCH...
  if (/\(9[1-9]\)/.test(clean)) {
    const re = /\((9[1-9])\)([^\(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) {
      set(m[1], m[2] || "");
    }
    out.parsed = true;
    return out;
  }

  // Machine format: 91SKU<GS>92BATCH<GS>... (all variable-length, GS-separated)
  const parts = clean.split(GS).filter(Boolean);
  for (const part of parts) {
    if (part.length < 2) continue;
    const ai = part.slice(0, 2);
    if (!/^9[1-9]$/.test(ai)) continue;
    set(ai, part.slice(2));
  }

  out.parsed = true;
  return out;
}

/**
 * Dual-mode parse:
 * - mode=GS1 when AI 00/01 signals exist
 * - mode=PIC when GS1 signals absent and only AI 91-99 are used
 * - otherwise INVALID
 */
export function parsePayload(rawInput: string): ParsedPayload {
  const raw = String(rawInput || "");
  const clean = normalizeRaw(raw);
  if (!clean) return { mode: "INVALID", error: "No payload provided", raw };

  if (looksLikeGS1(clean) || hasAnyAi(clean, ["00", "01", "10", "11", "17", "21"])) {
    try {
      const parsed = parseGS1(raw);
      return { mode: "GS1", parsed };
    } catch (e: any) {
      return { mode: "INVALID", error: e?.message || "GS1 parse error", raw };
    }
  }

  if (looksLikePICOnly(clean)) {
    try {
      const parsed = parsePIC(raw);
      if (!parsed.serial) {
        return { mode: "INVALID", error: "PIC payload missing serial (AI 95)", raw };
      }
      return { mode: "PIC", parsed };
    } catch (e: any) {
      return { mode: "INVALID", error: e?.message || "PIC parse error", raw };
    }
  }

  return { mode: "INVALID", error: "Unrecognized or mixed payload format", raw };
}


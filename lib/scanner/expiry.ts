export type ExpiryParseResult =
  | { ok: true; isoDate: string; year: number; month: number; day: number }
  | { ok: false; reason: "EMPTY" | "INVALID_FORMAT" | "INVALID_DATE" };

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function parseYYMMDD(value: string): ExpiryParseResult {
  if (!/^\d{6}$/.test(value)) return { ok: false, reason: "INVALID_FORMAT" };
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const year = 2000 + yy;
  if (!isValidCalendarDate(year, month, day)) {
    return { ok: false, reason: "INVALID_DATE" };
  }
  return { ok: true, isoDate: toIsoDate(year, month, day), year, month, day };
}

function parseISODate(value: string): ExpiryParseResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, reason: "INVALID_FORMAT" };
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!isValidCalendarDate(year, month, day)) {
    return { ok: false, reason: "INVALID_DATE" };
  }
  return { ok: true, isoDate: toIsoDate(year, month, day), year, month, day };
}

export function parseExpiryStrict(raw: unknown): ExpiryParseResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "EMPTY" };
  if (/^\d{6}$/.test(value)) return parseYYMMDD(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseISODate(value);
  return { ok: false, reason: "INVALID_FORMAT" };
}

export function isExpiredStrict(raw: unknown, now: Date = new Date()): { valid: boolean; expired: boolean; isoDate?: string } {
  const parsed = parseExpiryStrict(raw);
  if (!parsed.ok) return { valid: false, expired: false };
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return {
    valid: true,
    expired: expiryUtc < todayUtc,
    isoDate: parsed.isoDate,
  };
}


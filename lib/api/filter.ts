export function sanitizeFilterToken(value: unknown, maxLen = 120): string {
  return String(value ?? "")
    .trim()
    .slice(0, maxLen)
    .replace(/[^a-zA-Z0-9@._:\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSafeIlikePattern(value: unknown, maxLen = 120): string | null {
  const token = sanitizeFilterToken(value, maxLen);
  if (!token) return null;
  return `%${token}%`;
}

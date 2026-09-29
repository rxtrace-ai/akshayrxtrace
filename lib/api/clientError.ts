export function getApiErrorMessage(payload: unknown, fallback: string): string {
  const value = payload as any;
  const candidates = [
    value?.error?.message,
    value?.message,
    value?.legacy_message,
    value?.data?.error?.message,
    value?.error,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

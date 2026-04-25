export function createIdempotencyKey(prefix = "idem"): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const randomSuffix = Math.random().toString(16).slice(2) || "fallback";
  return `${prefix}:${Date.now()}:${randomSuffix}`;
}

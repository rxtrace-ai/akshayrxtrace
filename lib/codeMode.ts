export type CodeMode = "GS1" | "PIC";

export function resolveCodeMode(input: { gtin?: string | null }): CodeMode {
  const gtin = (input.gtin || "").trim();
  return gtin ? "GS1" : "PIC";
}


import { describe, expect, it } from "vitest";
import { parsePayload } from "@/lib/parsePayload";
import { buildPicUnitPayload } from "@/lib/picPayload";
import { generateCanonicalGS1 } from "@/lib/gs1Canonical";

describe("parsePayload", () => {
  it("classifies GS1 and extracts serialNo", () => {
    const gs1 = generateCanonicalGS1({
      gtin: "12345678901231",
      expiry: "2026-12-31",
      mfgDate: "2026-01-01",
      batch: "BATCH1",
      serial: "SERIAL1",
      sku: "SKU1",
    });
    const out = parsePayload(gs1);
    expect(out.mode).toBe("GS1");
    if (out.mode !== "GS1") return;
    expect(out.parsed.serialNo).toBe("SERIAL1");
    expect(out.parsed.gtin).toBeDefined();
  });

  it("classifies PIC and requires AI 95 serial", () => {
    const pic = buildPicUnitPayload({
      sku: "SKU001",
      batch: "BATCH123",
      expiryYYMMDD: "251231",
      serial: "UABC123",
    });
    const out = parsePayload(pic);
    expect(out.mode).toBe("PIC");
    if (out.mode !== "PIC") return;
    expect(out.parsed.serial).toBe("UABC123");
  });

  it("rejects PIC without serial (AI 95)", () => {
    const out = parsePayload("(92)BATCH(93)251231");
    expect(out.mode).toBe("INVALID");
  });
});


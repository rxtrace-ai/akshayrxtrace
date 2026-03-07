import { describe, expect, it } from "vitest";
import { generateCanonicalGS1 } from "@/lib/gs1Canonical";
import { generateUnitSerial } from "@/lib/serial/unitSerial";

describe("generateUnitSerial", () => {
  it("generates uppercase alphanumeric serials within GS1 AI(21) length", () => {
    const serial = generateUnitSerial();
    expect(serial).toMatch(/^[A-Z0-9]+$/);
    expect(serial.length).toBeLessThanOrEqual(20);
    expect(serial.length).toBe(18);
  });

  it("produces distinct serials across repeated calls", () => {
    const serials = new Set(Array.from({ length: 200 }, () => generateUnitSerial()));
    expect(serials.size).toBe(200);
  });
});

describe("generateCanonicalGS1", () => {
  it("builds the unit payload with AI 01, 17, 10, and 21 when optional fields are omitted", () => {
    const gs1 = generateCanonicalGS1({
      gtin: "12345678901231",
      expiry: "2026-12-31",
      batch: "BATCH1",
      serial: "SERIAL1",
    });

    expect(gs1).toContain("0112345678901231");
    expect(gs1).toContain("17261231");
    expect(gs1).toContain("10BATCH1");
    expect(gs1).toContain("21SERIAL1");
    expect(gs1).not.toContain("11");
    expect(gs1).not.toContain("91");
    expect(gs1).not.toContain("92");
  });
});

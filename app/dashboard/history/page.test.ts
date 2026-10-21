import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Scan Activity table", () => {
  it("renders exactly the seven requested columns in order and excludes IP", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const headers = [...source.matchAll(/<th className="p-4">([^<]+)<\/th>/g)].map((match) => match[1]);

    expect(headers).toEqual([
      "Status",
      "Serial Number",
      "GTIN",
      "Batch",
      "Expiry",
      "Handset ID",
      "Scanned At",
    ]);
    expect(source).not.toContain("IP Address");
    expect(source).toContain("displayValue(log.serial_number)");
    expect(source).toContain("displayValue(log.handset_id)");
  });
});

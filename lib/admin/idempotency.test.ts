import { describe, expect, it } from "vitest";
import { buildRequestHash } from "./idempotency";

describe("buildRequestHash", () => {
  it("is deterministic for equivalent objects with different key order", () => {
    const endpoint = "/api/admin/companies/123/freeze";
    const method = "PUT";
    const a = { freeze: true, reason: "ops", meta: { b: 2, a: 1 } };
    const b = { reason: "ops", meta: { a: 1, b: 2 }, freeze: true };

    const hashA = buildRequestHash(method, endpoint, a);
    const hashB = buildRequestHash(method, endpoint, b);

    expect(hashA).toBe(hashB);
  });

  it("changes hash when method changes", () => {
    const endpoint = "/api/admin/companies/123";
    const body = { ok: true };

    const putHash = buildRequestHash("PUT", endpoint, body);
    const deleteHash = buildRequestHash("DELETE", endpoint, body);

    expect(putHash).not.toBe(deleteHash);
  });
});

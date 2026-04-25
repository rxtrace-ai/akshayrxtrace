import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdempotencyKey } from "@/lib/http/idempotencyKey";

describe("createIdempotencyKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "uuid-test-1",
    });

    expect(createIdempotencyKey("subscription-cancel")).toBe("uuid-test-1");
  });

  it("falls back to a timestamped random string when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const key = createIdempotencyKey("subscription-cancel");

    expect(key).toMatch(/^subscription-cancel:\d+:[a-f0-9]+$/);
  });
});

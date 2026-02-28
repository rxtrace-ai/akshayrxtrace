import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "./rateLimit";

describe("consumeRateLimit", () => {
  it("allows requests until burst is exhausted", () => {
    const key = `test-burst-${Date.now()}`;
    const first = consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });
    const second = consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });
    const third = consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("returns retryAfterSeconds when blocked", () => {
    const key = `test-retry-${Date.now()}`;
    consumeRateLimit({ key, refillPerMinute: 1, burst: 1 });
    const blocked = consumeRateLimit({ key, refillPerMinute: 1, burst: 1 });

    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

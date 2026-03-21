import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "./rateLimit";

describe("consumeRateLimit", () => {
  it("allows requests until burst is exhausted", async () => {
    const key = `test-burst-${Date.now()}`;
    const first = await consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });
    const second = await consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });
    const third = await consumeRateLimit({ key, refillPerMinute: 60, burst: 2 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("returns retryAfterSeconds when blocked", async () => {
    const key = `test-retry-${Date.now()}`;
    await consumeRateLimit({ key, refillPerMinute: 1, burst: 1 });
    const blocked = await consumeRateLimit({ key, refillPerMinute: 1, burst: 1 });

    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

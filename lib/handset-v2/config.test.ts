import { describe, expect, it } from "vitest";
import { deriveTokenStatus, hashActivationToken, normalizeActivationToken, redactToken } from "./config";

describe("handset-v2 token helpers", () => {
  it("normalizes and hashes tokens deterministically", () => {
    const a = hashActivationToken("rx-ab12cd-34ef56");
    const b = hashActivationToken("RX-AB12CD-34EF56");

    expect(normalizeActivationToken(" rx-ab12cd-34ef56 ")).toBe("RX-AB12CD-34EF56");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("derives issued, active, exhausted, expired, revoked", () => {
    const now = new Date("2026-03-20T00:00:00Z");

    expect(
      deriveTokenStatus({ activation_count: 0, max_activations: 10, expires_at: "2026-03-21T00:00:00Z", revoked_at: null, now })
    ).toBe("issued");
    expect(
      deriveTokenStatus({ activation_count: 1, max_activations: 10, expires_at: "2026-03-21T00:00:00Z", revoked_at: null, now })
    ).toBe("active");
    expect(
      deriveTokenStatus({ activation_count: 10, max_activations: 10, expires_at: "2026-03-21T00:00:00Z", revoked_at: null, now })
    ).toBe("exhausted");
    expect(
      deriveTokenStatus({ activation_count: 0, max_activations: 10, expires_at: "2026-03-19T00:00:00Z", revoked_at: null, now })
    ).toBe("expired");
    expect(
      deriveTokenStatus({ activation_count: 0, max_activations: 10, expires_at: "2026-03-21T00:00:00Z", revoked_at: "2026-03-20T00:00:00Z", now })
    ).toBe("revoked");
  });

  it("redacts plaintext token", () => {
    const msg = "Activation failed for RX-7F3K9A-2D8LQ1 due to timeout";
    expect(redactToken(msg)).toContain("RX-******-******");
    expect(redactToken(msg)).not.toContain("RX-7F3K9A-2D8LQ1");
  });
});
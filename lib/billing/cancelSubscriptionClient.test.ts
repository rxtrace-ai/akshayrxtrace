import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/idempotencyKey", () => ({
  createIdempotencyKey: vi.fn(() => "cancel-idem-1"),
}));

import { buildCancelSubscriptionRequest } from "@/lib/billing/cancelSubscriptionClient";

describe("buildCancelSubscriptionRequest", () => {
  it("includes the Idempotency-Key header required by the cancel API", () => {
    const request = buildCancelSubscriptionRequest();

    expect(request.idempotencyKey).toBe("cancel-idem-1");
    expect(request.init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "cancel-idem-1",
      },
    });
  });
});

import { createIdempotencyKey } from "@/lib/http/idempotencyKey";

export function buildCancelSubscriptionRequest() {
  const idempotencyKey = createIdempotencyKey("subscription-cancel");

  return {
    idempotencyKey,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
    },
  };
}

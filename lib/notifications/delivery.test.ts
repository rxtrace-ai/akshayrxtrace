import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ claimed: true, claimError: null as any, finishError: null as any, rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/transactionalEmail", () => ({ sendTransactionalEmail: vi.fn(async () => ({ success: true })) }));

import { deliverNotification } from "./delivery";
import { sendTransactionalEmail } from "@/lib/transactionalEmail";

describe("notification delivery ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.claimed = true;
    state.claimError = null;
    state.finishError = null;
    state.rpc.mockImplementation(async (fn: string) => {
      if (fn === "claim_notification_delivery") return { data: state.claimed, error: state.claimError };
      return { data: null, error: state.finishError };
    });
  });

  it("sends once and records sent status", async () => {
    const result = await deliverNotification({
      eventType: "FREE_WELCOME", event: "FREE_WELCOME", companyId: "company-1", recipientEmail: "owner@example.com",
      idempotencyKey: "welcome:company-1", payload: {},
    });
    expect(result).toBe("sent");
    expect(sendTransactionalEmail).toHaveBeenCalledOnce();
    expect(state.rpc.mock.calls.map(([fn]) => fn)).toEqual(["claim_notification_delivery", "finish_notification_delivery"]);
  });

  it("skips a duplicate claim without sending", async () => {
    state.claimed = false;
    const result = await deliverNotification({
      eventType: "FREE_QUOTA_RESET", event: "FREE_QUOTA_RESET", companyId: "company-1", recipientEmail: "owner@example.com",
      idempotencyKey: "reset:company-1:2026-10", payload: {},
    });
    expect(result).toBe("duplicate");
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledOnce();
  });
});

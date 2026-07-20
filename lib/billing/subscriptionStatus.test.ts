import { describe, expect, it } from "vitest";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";

function createMockSupabase(params: {
  trialRow?: any;
  subscriptionRow?: any;
}) {
  return {
    from(table: string) {
      if (table === "company_trials") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: params.trialRow ?? null, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "company_subscriptions") {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle: async () => ({ data: params.subscriptionRow ?? null, error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as any;
}

describe("getUnifiedSubscriptionStatus", () => {
  it("returns active for an active subscription", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        subscriptionRow: {
          status: "active",
          cancel_at_period_end: false,
          current_period_end: "2026-05-10T00:00:00.000Z",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("active");
    expect(status.source).toBe("subscription");
  });

  it("keeps cancel-at-period-end subscriptions active until current_period_end", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        subscriptionRow: {
          status: "cancelled",
          cancel_at_period_end: true,
          current_period_end: "2026-05-10T00:00:00.000Z",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("active");
    expect(status.source).toBe("subscription");
    expect(status.rawStatus).toBe("cancelled");
    expect(status.paidThroughPeriodEnd).toBe(true);
  });

  it("blocks cancelled subscriptions after current_period_end has passed", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        subscriptionRow: {
          status: "cancelled",
          cancel_at_period_end: true,
          current_period_end: "2026-04-10T00:00:00.000Z",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("expired");
    expect(status.source).toBe("subscription");
  });

  it("returns active trial access when no effective paid subscription exists", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        trialRow: {
          trial_end: "2026-05-01T00:00:00.000Z",
          status: "active",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("active");
    expect(status.source).toBe("trial");
  });

  it("returns expired when there is no subscription and the trial has ended", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        trialRow: {
          trial_end: "2026-04-01T00:00:00.000Z",
          status: "expired",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("expired");
    expect(status.source).toBe("trial");
  });

  it("prioritizes effective paid access over trial status", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        trialRow: {
          trial_end: "2026-05-01T00:00:00.000Z",
          status: "active",
        },
        subscriptionRow: {
          status: "active",
          cancel_at_period_end: false,
          current_period_end: "2026-05-10T00:00:00.000Z",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(status.status).toBe("active");
    expect(status.source).toBe("subscription");
    expect(status.trialExpiresAt).toBeUndefined();
  });

  it("returns cancelled trial when a future-dated trial has been cancelled", async () => {
    const status = await getUnifiedSubscriptionStatus({
      supabase: createMockSupabase({
        trialRow: {
          trial_end: "2099-01-01T00:00:00.000Z",
          status: "cancelled",
        },
      }),
      companyId: "company-1",
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    expect(status.status).toBe("cancelled");
    expect(status.source).toBe("trial");
  });
});

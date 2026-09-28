import { describe, expect, it } from "vitest";
import { getUnifiedSubscriptionStatus } from "@/lib/billing/subscriptionStatus";

function createMockSupabase(params: {
  subscriptionRow?: any;
}) {
  return {
    from(table: string) {
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

});

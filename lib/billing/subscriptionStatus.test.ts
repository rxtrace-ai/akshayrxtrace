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

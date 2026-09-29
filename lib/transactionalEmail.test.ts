import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTransactionalEmail } from "./transactionalEmail";

describe("subscription notification templates", () => {
  const originalKey = process.env.RESEND_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it.each([
    ["FREE_WELCOME", "Welcome to RxTrace — Your FREE Subscription is Active", "Acme Labs"],
    ["FREE_QUOTA_RESET", "Your RxTrace Monthly Quota Has Been Refreshed", "Next reset date"],
    ["SUBSCRIPTION_UPGRADED", "Your RxTrace Subscription Has Been Upgraded", "Previous plan: FREE"],
    ["SUBSCRIPTION_RENEWED", "Your RxTrace Subscription Has Been Renewed", "Remaining quota"],
    ["SUBSCRIPTION_PAYMENT_FAILED", "Action Required: Subscription Renewal Failed", "Grace period"],
  ] as const)("sends %s with the requested subject and details", async (event, subject, expectedBody) => {
    process.env.RESEND_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.subject).toBe(subject);
      expect(body.html).toContain(expectedBody);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const payload: Record<string, any> = {
      user_name: "Owner", company_name: "Acme Labs", login_link: "https://rxtrace.in/login",
      getting_started_link: "https://rxtrace.in/dashboard", quotas: "Unit QR 10", reset_date: "01 Oct 2026", next_reset_date: "01 Nov 2026",
      previous_plan: "FREE", new_plan: "STARTER", billing_cycle: "Monthly", effective_date: "01 Oct 2026",
      plan: "STARTER", start_date: "01 Oct 2026", end_date: "01 Nov 2026", remaining_quota: "Unit QR 10", invoice_link: "https://rxtrace.in/invoice",
      retry_link: "https://rxtrace.in/subscription", grace_period: "Retry promptly", support_email: "support@rxtrace.in",
    };
    await sendTransactionalEmail({ to: "owner@example.com", event, payload, idempotencyKey: "test-event-key" } as any);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe("test-event-key");
  });
});

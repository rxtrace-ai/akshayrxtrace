import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ deviceAuth: null as any, companyId: "user-company" as string | null }));

vi.mock("@/lib/company/resolve", () => ({
  resolveCompanyIdFromRequest: async () => state.companyId,
}));
vi.mock("./auth", () => ({
  verifyDeviceAuthToken: async () => state.deviceAuth || { ok: false, reason: "Invalid device auth token" },
}));

describe("resolveScannerRequestContext", () => {
  it("uses only validated handset identity and company claims", async () => {
    state.companyId = "user-company";
    state.deviceAuth = { ok: true, companyId: "handset-company", handsetId: "registered-handset-id" };
    const { resolveScannerRequestContext } = await import("@/lib/handset-v2/scannerContext");
    const result = await resolveScannerRequestContext(new Request("http://localhost", {
      headers: { Authorization: "Bearer signed-device-token" },
    }));

    expect(result).toEqual({ companyId: "handset-company", handsetId: "registered-handset-id" });
  });

  it("uses existing user/session company auth without inventing a handset ID", async () => {
    state.deviceAuth = null;
    state.companyId = "user-company";
    const { resolveScannerRequestContext } = await import("@/lib/handset-v2/scannerContext");
    const result = await resolveScannerRequestContext(new Request("http://localhost"));

    expect(result).toEqual({ companyId: "user-company", handsetId: null });
  });
});

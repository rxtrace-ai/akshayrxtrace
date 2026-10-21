import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ handset: null as any }));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: state.handset && filters.every(([column, value]) => state.handset[column] === value) ? state.handset : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

describe("verifyDeviceAuthToken", () => {
  beforeEach(() => {
    process.env.HANDSET_DEVICE_AUTH_SECRET = "test-only-handset-secret";
  });
  afterEach(() => {
    delete process.env.HANDSET_DEVICE_AUTH_SECRET;
  });

  it("resolves the registered handset only when its company and device are active and match", async () => {
    const { signDeviceAuthToken, verifyDeviceAuthToken } = await import("@/lib/handset-v2/auth");
    state.handset = { id: "handset-1", company_id: "company-1", device_id: "device-1", status: "ACTIVE", disabled_at: null };
    const token = signDeviceAuthToken({ handsetId: "handset-1", companyId: "company-1", deviceId: "device-1" });

    await expect(verifyDeviceAuthToken(`Bearer ${token}`)).resolves.toMatchObject({
      ok: true,
      handsetId: "handset-1",
      companyId: "company-1",
      deviceId: "device-1",
    });
  });

  it("rejects revoked or inactive handset records", async () => {
    const { signDeviceAuthToken, verifyDeviceAuthToken } = await import("@/lib/handset-v2/auth");
    state.handset = { id: "handset-1", company_id: "company-1", device_id: "device-1", status: "DISABLED", disabled_at: "2026-01-01T00:00:00Z" };
    const token = signDeviceAuthToken({ handsetId: "handset-1", companyId: "company-1", deviceId: "device-1" });

    await expect(verifyDeviceAuthToken(`Bearer ${token}`)).resolves.toMatchObject({ ok: false });
  });

  it("does not associate a handset from another company", async () => {
    const { signDeviceAuthToken, verifyDeviceAuthToken } = await import("@/lib/handset-v2/auth");
    state.handset = { id: "handset-1", company_id: "company-2", device_id: "device-1", status: "ACTIVE", disabled_at: null };
    const token = signDeviceAuthToken({ handsetId: "handset-1", companyId: "company-1", deviceId: "device-1" });

    await expect(verifyDeviceAuthToken(`Bearer ${token}`)).resolves.toMatchObject({ ok: false });
  });
});

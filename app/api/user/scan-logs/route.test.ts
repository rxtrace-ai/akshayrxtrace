import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as any[],
  companyFilters: [] as any[],
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const query: any = {
        select: () => query,
        eq: (...args: any[]) => { state.companyFilters.push(args); return query; },
        order: () => query,
        range: async () => ({ data: state.rows, error: null, count: state.rows.length }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/company/resolve", () => ({
  resolveCompanyForUser: async () => ({ companyId: "company-1", company: { id: "company-1" }, isOwner: true }),
}));

describe("GET /api/user/scan-logs", () => {
  beforeEach(() => {
    state.rows = [];
    state.companyFilters = [];
  });

  it("returns the seven display fields from parsed GS1 values and scopes rows to the company", async () => {
    state.rows = [{
      id: "log-1",
      scanned_at: "2026-10-21T10:00:00.000Z",
      raw_scan: "raw-value",
      parsed: { mode: "GS1", serialNo: "S-1", gtin: "00012345678905", batchNo: "B-1", expiryDate: "31-12-2027" },
      metadata: { status: "DUPLICATE" },
      status: "DUPLICATE",
      handset_id: "handset-uuid-1",
      ip: "192.0.2.1",
    }];
    const { GET } = await import("@/app/api/user/scan-logs/route");
    const response = await GET(new Request("http://localhost/api/user/scan-logs"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(state.companyFilters).toContainEqual(["company_id", "company-1"]);
    expect(json.data.items[0]).toMatchObject({
      status: "DUPLICATE",
      serial_number: "S-1",
      gtin: "00012345678905",
      batch: "B-1",
      expiry: "31-12-2027",
      handset_id: "handset-uuid-1",
      scanned_at: "2026-10-21T10:00:00.000Z",
    });
    expect(json.data.items[0]).not.toHaveProperty("ip");
    expect(json.data.items[0]).not.toHaveProperty("raw_scan");
    expect(json.data.items[0]).toHaveProperty("serial_number");
    expect(json.data.items[0]).toHaveProperty("handset_id");
  });

  it("supports legacy parsed AI keys and missing status or handset values", async () => {
    state.rows = [{
      id: "legacy-1",
      scanned_at: "2026-10-20T08:00:00.000Z",
      raw_scan: null,
      parsed: { "21": "S-2", "01": "00000000000000", "10": "LOT-2", "17": "20-10-2027" },
      metadata: { status: "VALID" },
      status: null,
      handset_id: null,
    }];
    const { GET } = await import("@/app/api/user/scan-logs/route");
    const response = await GET(new Request("http://localhost/api/user/scan-logs"));
    const json = await response.json();

    expect(json.data.items[0]).toMatchObject({
      status: "VALID",
      serial_number: "S-2",
      gtin: "00000000000000",
      batch: "LOT-2",
      expiry: "20-10-2027",
      handset_id: null,
    });
  });
});

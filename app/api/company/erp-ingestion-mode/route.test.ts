import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  ownerOk: true,
  currentMode: "unit",
  updatedMode: null as string | null,
  auditCalls: [] as any[],
}));

vi.mock("@/lib/billing/userSubscriptionAuth", () => ({
  requireOwnerContext: async () => {
    if (!mockState.ownerOk) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }

    const supabase: any = {
      from: (table: string) => {
        if (table !== "companies") throw new Error(`Unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { erp_ingestion_mode: mockState.currentMode },
                error: null,
              }),
            }),
          }),
          update: (payload: any) => {
            mockState.updatedMode = payload.erp_ingestion_mode;
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      },
    };

    return {
      ok: true,
      userId: "owner-1",
      companyId: "company-1",
      companyName: "RxTrace Co",
      userEmail: "owner@rxtrace.in",
      supabase,
    };
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: async (payload: any) => {
    mockState.auditCalls.push(payload);
  },
}));

describe("ERP ingestion mode route", () => {
  beforeEach(() => {
    mockState.ownerOk = true;
    mockState.currentMode = "unit";
    mockState.updatedMode = null;
    mockState.auditCalls = [];
  });

  it("rejects non-owner access", async () => {
    mockState.ownerOk = false;
    const { GET } = await import("@/app/api/company/erp-ingestion-mode/route");

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("rejects invalid ingestion mode updates", async () => {
    const { POST } = await import("@/app/api/company/erp-ingestion-mode/route");
    const req = new Request("http://localhost/api/company/erp-ingestion-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingestion_mode: "bad-mode" }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("REQUEST_FAILED");
    expect(json.error.message).toBe("Invalid ERP ingestion mode");
    expect(mockState.updatedMode).toBeNull();
  });

  it("updates mode and writes an audit log for owner requests", async () => {
    const { POST } = await import("@/app/api/company/erp-ingestion-mode/route");
    const req = new Request("http://localhost/api/company/erp-ingestion-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingestion_mode: "both" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.ingestion_mode).toBe("both");
    expect(mockState.updatedMode).toBe("both");
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.auditCalls[0]).toMatchObject({
      companyId: "company-1",
      actor: "owner-1",
      action: "ERP_INGESTION_MODE_UPDATED",
      status: "success",
    });
  });
});

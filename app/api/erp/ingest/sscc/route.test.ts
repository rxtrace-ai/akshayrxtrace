import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  userId: "user-1",
  sessionMode: "replay" as "replay" | "in_progress",
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: mockState.userId } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { id: "company-1", company_name: "RxTrace Co" }, error: null }),
              maybeSingle: async () => ({ data: { erp_ingestion_mode: "both" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/erp/importSessions", () => ({
  beginErpImportSession: async () => {
    if (mockState.sessionMode === "in_progress") {
      return { mode: "in_progress", sessionId: "session-1" };
    }
    return {
      mode: "replay",
      sessionId: "session-1",
      responseStatus: 200,
      result: { success: true, replay: true, imported: 2 },
    };
  },
  completeErpImportSession: async () => undefined,
  computeErpImportRequestHash: () => "hash-1",
  ErpImportIdempotencyError: class extends Error {},
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: async () => undefined,
}));

describe("POST /api/erp/ingest/sscc", () => {
  beforeEach(() => {
    mockState.userId = "user-1";
    mockState.sessionMode = "replay";
  });

  it("replays completed SSCC import sessions by idempotency key", async () => {
    const { POST } = await import("@/app/api/erp/ingest/sscc/route");
    const req = new Request("http://localhost/api/erp/ingest/sscc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-sscc-1",
      },
      body: JSON.stringify({ rows: [{ sscc: "012345678901234567" }] }),
    });

    const res = (await POST(req))!;
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.replay).toBe(true);
  });

  it("rejects concurrent SSCC imports with the same in-flight idempotency key", async () => {
    mockState.sessionMode = "in_progress";
    const { POST } = await import("@/app/api/erp/ingest/sscc/route");
    const req = new Request("http://localhost/api/erp/ingest/sscc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-sscc-1",
      },
      body: JSON.stringify({ rows: [{ sscc: "012345678901234567" }] }),
    });

    const res = (await POST(req))!;
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("REQUEST_FAILED");
    expect(json.error.message).toContain("already processing");
  });
});

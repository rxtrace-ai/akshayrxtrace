import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  authorized: true,
  rows: [
    {
      id: "session-1",
      company_id: "company-1",
      actor: "user-1",
      import_type: "unit",
      idempotency_key: "idem-1",
      status: "completed",
      total_rows: 20,
      validated_rows: 18,
      imported_rows: 15,
      duplicate_rows: 2,
      skipped_rows: 1,
      invalid_rows: 2,
      response_status: 200,
      error_message: null,
      created_at: "2026-03-27T10:00:00.000Z",
      updated_at: "2026-03-27T10:01:00.000Z",
    },
  ] as any[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdminRole: async () =>
    mockState.authorized
      ? { userId: "admin-1", role: "support_admin" }
      : {
          userId: "",
          role: null,
          error: new Response(JSON.stringify({ error: "FORBIDDEN" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
        },
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "erp_import_sessions") throw new Error(`Unexpected table ${table}`);
      const builder: any = {
        select: () => builder,
        order: () => builder,
        eq: () => builder,
        or: () => builder,
        range: async () => ({
          data: mockState.rows,
          error: null,
          count: mockState.rows.length,
        }),
      };
      return builder;
    },
  }),
}));

describe("GET /api/admin/audit/erp-import-sessions", () => {
  beforeEach(() => {
    mockState.authorized = true;
  });

  it("rejects non-admin access", async () => {
    mockState.authorized = false;
    const { GET } = await import("@/app/api/admin/audit/erp-import-sessions/route");
    const req = new Request("http://localhost/api/admin/audit/erp-import-sessions");

    const res = await GET(req as any);
    expect(res.status).toBe(403);
  });

  it("returns paginated ERP import sessions for admins", async () => {
    const { GET } = await import("@/app/api/admin/audit/erp-import-sessions/route");
    const req = new Request("http://localhost/api/admin/audit/erp-import-sessions?page=1&page_size=20");

    const res = await GET(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.total).toBe(1);
    expect(json.rows[0].id).toBe("session-1");
    expect(json.rows[0].import_type).toBe("unit");
  });
});

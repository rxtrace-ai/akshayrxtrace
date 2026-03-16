import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSeatInviteToken } from "@/lib/seats/invitations";

type MockUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

type MockDb = {
  companyId: string;
  seats: any[];
  seatInvitations: any[];
  userProfiles: any[];
  seatPlantAssignments: any[];
  plants: any[];
};

let currentUser: MockUser | null = null;
let db: MockDb;

class QueryBuilder {
  private filters: Array<(row: any) => boolean> = [];
  private orderBy: { col: string; asc: boolean } | null = null;

  constructor(private table: string) {}

  select(_cols: string) {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col: column, asc: opts?.ascending !== false };
    return this;
  }

  async maybeSingle() {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }

  then(resolve: (value: any) => void) {
    resolve({ data: this.run(), error: null });
    return Promise.resolve();
  }

  private run() {
    let source: any[] = [];
    if (this.table === "seats") source = db.seats;
    if (this.table === "seat_invitations") source = db.seatInvitations;
    if (this.table === "user_profiles") source = db.userProfiles;
    if (this.table === "seat_plant_assignments") source = db.seatPlantAssignments;
    if (this.table === "plants") source = db.plants;

    let rows = source.filter((row) => this.filters.every((fn) => fn(row)));
    if (this.table === "seat_plant_assignments") {
      rows = rows.map((row) => ({
        ...row,
        plants: db.plants.find((p) => p.id === row.plant_id) ?? null,
      }));
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = rows.sort((a, b) => {
        const left = a[col] ?? "";
        const right = b[col] ?? "";
        return asc ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left));
      });
    }
    return rows;
  }
}

function createMockClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: currentUser }, error: currentUser ? null : new Error("Unauthorized") }),
    },
    from: (table: string) => {
      const qb: any = new QueryBuilder(table);
      qb.upsert = async (payload: any, opts?: { onConflict?: string }) => {
        const conflictKey = opts?.onConflict || "id";
        const index = db.userProfiles.findIndex((row) => row[conflictKey] === payload[conflictKey]);
        if (index >= 0) db.userProfiles[index] = { ...db.userProfiles[index], ...payload };
        else db.userProfiles.push({ created_at: new Date().toISOString(), ...payload });
        return { data: payload, error: null };
      };
      return qb;
    },
    rpc: async (name: string, params: Record<string, any>) => {
      if (name === "create_seat_invitation_atomic") {
        const seatId = "seat-1";
        const invitationId = "invite-1";
        const rawToken = "token-123";
        const tokenHash = hashSeatInviteToken(rawToken);
        db.seats.push({
          id: seatId,
          company_id: db.companyId,
          email: params.p_email,
          role: params.p_role,
          status: "pending",
          active: false,
          user_id: null,
          invited_at: new Date().toISOString(),
          activated_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        db.seatInvitations.push({
          id: invitationId,
          seat_id: seatId,
          company_id: db.companyId,
          email: params.p_email,
          token_hash: tokenHash,
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          consumed_at: null,
          created_at: new Date().toISOString(),
        });
        return {
          data: {
            success: true,
            seat: db.seats[0],
            invitation_id: invitationId,
            token: rawToken,
            invite_url: `/invite/accept?token=${rawToken}`,
            expires_at: db.seatInvitations[0].expires_at,
          },
          error: null,
        };
      }

      if (name === "accept_seat_invitation") {
        const invite = db.seatInvitations.find((i) => i.token_hash === params.p_token_hash);
        if (!invite) return { data: null, error: new Error("INVITATION_NOT_FOUND") };
        const seat = db.seats.find((s) => s.id === invite.seat_id);
        if (!seat) return { data: null, error: new Error("SEAT_NOT_FOUND") };
        seat.user_id = params.p_user_id;
        seat.status = "active";
        seat.active = true;
        seat.activated_at = new Date().toISOString();
        seat.updated_at = new Date().toISOString();
        invite.status = "accepted";
        invite.consumed_at = new Date().toISOString();
        return { data: { success: true, seat, invitation_id: invite.id }, error: null };
      }

      if (name === "get_company_entitlement_snapshot") {
        return {
          data: {
            limits: { seat: 5 },
            usage: { seat: db.seats.filter((s) => s.status === "active" && s.active).length },
            remaining: {
              seat: Math.max(0, 5 - db.seats.filter((s) => s.status === "active" && s.active).length),
            },
            state: "ACTIVE",
          },
          error: null,
        };
      }

      return { data: null, error: new Error(`Unknown rpc: ${name}`) };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => createMockClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => createMockClient(),
}));

vi.mock("@/lib/company/resolve", () => ({
  resolveCompanyForUser: async (_client: any, userId: string) => {
    if (userId === "owner-1") return { companyId: db.companyId, isOwner: true, company: { id: db.companyId } };
    if (userId === "invited-1") return { companyId: db.companyId, isOwner: false, company: { id: db.companyId } };
    return null;
  },
}));

vi.mock("@/lib/email", () => ({
  sendInviteEmail: async () => ({ success: true, provider: "smtp" }),
}));

describe("invite -> profile -> seat integration guard", () => {
  beforeEach(() => {
    db = {
      companyId: "company-1",
      seats: [],
      seatInvitations: [],
      userProfiles: [],
      seatPlantAssignments: [],
      plants: [{ id: "plant-1", company_id: "company-1", status: "active", name: "Plant A" }],
    };
    currentUser = null;
  });

  it("creates invite, accepts it, ensures profile exists, and returns seat in owner API", async () => {
    const { POST: invitePost } = await import("@/app/api/admin/seats/invite/route");
    const { POST: acceptPost } = await import("@/app/api/user/seats/invitations/accept/route");
    const { GET: seatsGet } = await import("@/app/api/user/seats/route");

    currentUser = { id: "owner-1", email: "owner@rxtrace.in", user_metadata: { full_name: "Owner" } };
    const inviteReq = new Request("http://localhost/api/admin/seats/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "member@rxtrace.in",
        role: "operator",
        plant_ids: ["plant-1"],
      }),
    });
    const inviteRes = await invitePost(inviteReq);
    expect(inviteRes.status).toBe(200);

    currentUser = { id: "invited-1", email: "member@rxtrace.in", user_metadata: { full_name: "Member Name" } };
    const acceptReq = new Request("http://localhost/api/user/seats/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-123" }),
    });
    const acceptRes = await acceptPost(acceptReq);
    expect(acceptRes.status).toBe(200);

    const acceptedSeat = db.seats.find((s) => s.email === "member@rxtrace.in");
    expect(acceptedSeat?.status).toBe("active");

    const profile = db.userProfiles.find((p) => p.user_id === "invited-1");
    expect(profile).toBeTruthy();

    currentUser = { id: "owner-1", email: "owner@rxtrace.in", user_metadata: { full_name: "Owner" } };
    const seatsRes = await seatsGet();
    expect(seatsRes.status).toBe(200);
    const payload = await seatsRes.json();
    expect(payload.seats.length).toBe(1);
    expect(payload.seats[0].status).toBe("active");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  featureEnabled: true,
  secretMissing: false,
  rateAllowed: true,
  rpcData: null as any,
  rpcError: null as any,
  snapshotData: { remaining: { handset: 2 } } as any,
  snapshotError: null as any,
  tokenRow: {
    id: "token-1",
    company_id: "company-1",
    activation_count: 0,
    max_activations: 10,
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null as string | null,
  },
  insertedHandsetId: "handset-fallback-1",
}));

vi.mock("@/lib/security/rateLimit", () => ({
  consumeRateLimit: async () => ({
    allowed: mockState.rateAllowed,
    retryAfterSeconds: mockState.rateAllowed ? 0 : 30,
  }),
}));

vi.mock("@/lib/handset-v2/config", () => ({
  isHandsetV2Enabled: () => mockState.featureEnabled,
  normalizeActivationToken: (v: string) => String(v || "").trim().toUpperCase(),
  hashActivationToken: (v: string) => `hash:${String(v || "").trim().toUpperCase()}`,
  redactToken: (v: string) => String(v || "").replace(/RX-[A-Z0-9]{6}-[A-Z0-9]{6}/g, "RX-******-******"),
  safeIpFromRequest: () => "127.0.0.1",
}));

vi.mock("@/lib/handset-v2/auth", () => ({
  signDeviceAuthToken: () => {
    if (mockState.secretMissing) {
      throw new Error("Missing HANDSET_DEVICE_AUTH_SECRET");
    }
    return "device.jwt.token";
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => {
    const supabase: any = {
      rpc: async (fn: string) => {
        if (fn === "get_company_entitlement_snapshot") {
          return { data: mockState.snapshotData, error: mockState.snapshotError };
        }
        return { data: mockState.rpcData, error: mockState.rpcError };
      },
      from: (table: string) => {
        if (table === "handset_activation_tokens") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: mockState.tokenRow, error: null }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === "handsets") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: mockState.insertedHandsetId }, error: null }),
              }),
            }),
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { id: mockState.insertedHandsetId }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "handset_logs") {
          return {
            insert: async () => ({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    return supabase;
  },
}));

async function callActivate(body: Record<string, unknown>) {
  vi.resetModules();
  const { POST } = await import("@/app/api/handset/token/activate/route");
  const req = new Request("http://localhost/api/handset/token/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = await res.json();
  return { res, json };
}

describe("POST /api/handset/token/activate", () => {
  beforeEach(() => {
    mockState.featureEnabled = true;
    mockState.secretMissing = false;
    mockState.rateAllowed = true;
    mockState.rpcError = null;
    mockState.snapshotData = { remaining: { handset: 2 } };
    mockState.snapshotError = null;
    mockState.rpcData = {
      handset_id: "handset-1",
      company_id: "company-1",
      activation_count: 1,
      max_activations: 10,
    };
    mockState.tokenRow = {
      id: "token-1",
      company_id: "company-1",
      activation_count: 0,
      max_activations: 10,
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    };
    mockState.insertedHandsetId = "handset-fallback-1";
  });

  it("activates successfully via RPC", async () => {
    const { res, json } = await callActivate({
      token: "RX-ABC123-DEF456",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
      app_version: "1.0.0",
      device_name: "android",
    });

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.device_auth_token).toBe("device.jwt.token");
    expect(json.handset_id).toBe("handset-1");
  });

  it("returns INVALID_TOKEN for bad token format", async () => {
    const { res, json } = await callActivate({
      token: "BAD",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
    });

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("INVALID_TOKEN");
    expect(typeof json.error.message).toBe("string");
  });

  it("maps known RPC errors to structured API errors", async () => {
    mockState.rpcData = null;
    mockState.rpcError = { message: "TOKEN_EXPIRED" };

    const { res, json } = await callActivate({
      token: "RX-ABC123-DEF456",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
    });

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("TOKEN_EXPIRED");
    expect(json.error.message).toContain("expired");
  });

  it("falls back successfully when RPC is unavailable", async () => {
    mockState.rpcData = null;
    mockState.rpcError = { message: "function activate_handset_v2 does not exist", code: "42883" };
    mockState.insertedHandsetId = "handset-fallback-ok";

    const { res, json } = await callActivate({
      token: "RX-ABC123-DEF456",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
      app_version: "1.0.0",
      device_name: "android",
    });

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.handset_id).toBe("handset-fallback-ok");
    expect(json.device_auth_token).toBe("device.jwt.token");
  });

  it("maps handset quota errors to structured API errors", async () => {
    mockState.rpcData = null;
    mockState.rpcError = { message: "HANDSET_QUOTA_EXCEEDED" };

    const { res, json } = await callActivate({
      token: "RX-ABC123-DEF456",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
    });

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("QUOTA_EXCEEDED");
  });

  it("enforces handset quota in fallback mode", async () => {
    mockState.rpcData = null;
    mockState.rpcError = { message: "function activate_handset_v2 does not exist", code: "42883" };
    mockState.snapshotData = { remaining: { handset: 0 } };

    const { res, json } = await callActivate({
      token: "RX-ABC123-DEF456",
      device_id: "00000000-0000-4000-8000-000000000001",
      platform: "android",
    });

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("QUOTA_EXCEEDED");
  });
});

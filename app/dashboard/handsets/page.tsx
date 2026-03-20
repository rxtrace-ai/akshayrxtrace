"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Handset = {
  id: string;
  status: string;
  device_id: string | null;
  platform: string | null;
  app_version: string | null;
  device_name: string | null;
  activated_at: string | null;
  disabled_at: string | null;
  is_active: boolean;
};

type TokenRow = {
  id: string;
  status: "issued" | "active" | "exhausted" | "expired" | "revoked";
  max_activations: number;
  activation_count: number;
  expires_at: string;
  created_at: string;
};

type LogRow = {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
  handset_id: string | null;
};

export default function HandsetsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [plainToken, setPlainToken] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenMaxActivations, setTokenMaxActivations] = useState(0);
  const [expiryHours, setExpiryHours] = useState("24");
  const [maxActivations, setMaxActivations] = useState("10");
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [handsets, setHandsets] = useState<Handset[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listRes, logsRes] = await Promise.all([
        fetch("/api/handset/list", { cache: "no-store" }),
        fetch("/api/handset/logs?limit=100", { cache: "no-store" }),
      ]);

      const listJson = await listRes.json().catch(() => ({}));
      const logsJson = await logsRes.json().catch(() => ({}));

      if (!listRes.ok) {
        throw new Error(String(listJson.error || "Failed to load handsets"));
      }
      if (!logsRes.ok) {
        throw new Error(String(logsJson.error || "Failed to load logs"));
      }

      setHandsets(Array.isArray(listJson.handsets) ? listJson.handsets : []);
      setTokens(Array.isArray(listJson.tokens) ? listJson.tokens : []);
      setLogs(Array.isArray(logsJson.logs) ? logsJson.logs : []);
    } catch (err: any) {
      setError(String(err?.message || "Failed to load handsets"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeHandsetCount = useMemo(() => handsets.filter((h) => h.is_active).length, [handsets]);
  const tokenShareMessage = useMemo(() => {
    if (!plainToken) return "";
    const expiresLabel = tokenExpiresAt ? new Date(tokenExpiresAt).toLocaleString() : "-";
    const maxLabel = tokenMaxActivations > 0 ? String(tokenMaxActivations) : "-";
    return [
      `RxTrace handset activation token: ${plainToken}`,
      `Valid until: ${expiresLabel}`,
      `Max activations: ${maxLabel}`,
      "Open the scanner app, tap Activate, and enter this token.",
    ].join("\n");
  }, [plainToken, tokenExpiresAt, tokenMaxActivations]);

  async function handleCreateToken() {
    setError("");
    setSuccess("");
    setPlainToken("");
    setTokenExpiresAt("");
    setTokenMaxActivations(0);

    const payload = {
      expiry_hours: Number(expiryHours || 24),
      max_activations: Number(maxActivations || 10),
    };

    const res = await fetch("/api/handset/token/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(String(json.error || "Token creation failed"));
      return;
    }

    setPlainToken(String(json.token || ""));
    setTokenExpiresAt(String(json.expires_at || ""));
    setTokenMaxActivations(Number(json.max_activations || 0));
    setSuccess("Token generated. Copy it now; it is shown once.");
    await refresh();
  }

  async function handleDisableHandset(handsetId: string) {
    setError("");
    setSuccess("");
    const res = await fetch(`/api/handset/${handsetId}/disable`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(json.error || "Failed to disable handset"));
      return;
    }
    setSuccess("Handset disabled");
    await refresh();
  }

  async function handleRevokeToken(tokenId: string) {
    setError("");
    setSuccess("");
    const res = await fetch("/api/handset/token/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_id: tokenId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(json.error || "Failed to revoke token"));
      return;
    }
    setSuccess("Token revoked");
    await refresh();
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900">Handsets</h1>
        <p className="text-sm text-gray-600">Token-based multi-device activation and handset controls.</p>
      </div>

      {error ? (
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-700">{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert className="border-green-200 bg-green-50">
          <AlertDescription className="text-green-700">{success}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Active Handsets</CardTitle>
            <CardDescription>Counted against current entitlement</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{activeHandsetCount}</div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Generate Token</CardTitle>
            <CardDescription>Returns plaintext token once. Share securely.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                type="number"
                min={1}
                max={24}
                value={expiryHours}
                onChange={(e) => setExpiryHours(e.target.value)}
                placeholder="Expiry hours"
              />
              <Input
                type="number"
                min={1}
                max={10}
                value={maxActivations}
                onChange={(e) => setMaxActivations(e.target.value)}
                placeholder="Max activations"
              />
            </div>
            <Button onClick={handleCreateToken}>Generate Token</Button>
            {plainToken ? (
              <div className="space-y-3 rounded-md border bg-gray-50 p-3">
                <div className="font-mono text-sm tracking-wide">{plainToken}</div>
                <div className="text-xs text-gray-600">
                  Valid until: {tokenExpiresAt ? new Date(tokenExpiresAt).toLocaleString() : "-"} | Max activations:{" "}
                  {tokenMaxActivations > 0 ? tokenMaxActivations : "-"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild type="button" variant="outline">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(tokenShareMessage)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Share via WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activation Tokens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-gray-500">Loading...</p> : null}
          {tokens.length === 0 && !loading ? <p className="text-sm text-gray-500">No tokens issued yet.</p> : null}
          {tokens.map((token) => (
            <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{token.status.toUpperCase()}</div>
                <div className="text-gray-600">{token.activation_count} / {token.max_activations} activations</div>
                <div className="text-gray-500">Expires: {new Date(token.expires_at).toLocaleString()}</div>
              </div>
              {token.status !== "revoked" ? (
                <Button variant="outline" onClick={() => handleRevokeToken(token.id)}>Revoke</Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Handsets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {handsets.length === 0 && !loading ? <p className="text-sm text-gray-500">No handsets yet.</p> : null}
          {handsets.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">{h.device_name || h.device_id || h.id}</div>
                <div className="text-gray-600">Status: {h.status}</div>
                <div className="text-gray-500">Activated: {h.activated_at ? new Date(h.activated_at).toLocaleString() : "-"}</div>
              </div>
              {h.is_active ? <Button variant="outline" onClick={() => handleDisableHandset(h.id)}>Disable</Button> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {logs.length === 0 && !loading ? <p className="text-sm text-gray-500">No log events yet.</p> : null}
          {logs.map((log) => (
            <div key={log.id} className="rounded-md border p-3 text-sm">
              <div className="font-medium">{log.event_type}</div>
              <div className="text-gray-500">{new Date(log.created_at).toLocaleString()}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

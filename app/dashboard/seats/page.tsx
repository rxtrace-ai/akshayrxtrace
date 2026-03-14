"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubscriptionSummary } from "@/lib/hooks/useSubscriptionSummary";

type SeatSummary = {
  allocated: number;
  active: number;
  pending: number;
  remaining: number;
  blocked?: boolean;
  reason?: string | null;
};

type SeatRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  role: string | null;
  status: string | null;
  active: boolean | null;
  invited_at: string | null;
  activated_at: string | null;
  assigned_plants: Array<{ id: string; name: string | null; status: string | null }>;
  invitation: {
    id: string;
    status: string;
    expires_at: string | null;
    consumed_at: string | null;
  } | null;
};

type PlantOption = {
  id: string;
  name: string;
  status: string;
};

export default function SeatsManagementPage() {
  const [summary, setSummary] = useState<SeatSummary>({
    allocated: 0,
    active: 0,
    pending: 0,
    remaining: 0,
  });
  const { data: subscriptionSummary } = useSubscriptionSummary();
  const [rows, setRows] = useState<SeatRow[]>([]);
  const [plants, setPlants] = useState<PlantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "operator",
    plant_ids: [] as string[],
  });

  const selectedPlants = useMemo(
    () => new Set(form.plant_ids),
    [form.plant_ids]
  );

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [seatsRes, plantsRes] = await Promise.all([
        fetch("/api/user/seats", { cache: "no-store" }),
        fetch("/api/user/seats/plants", { cache: "no-store" }),
      ]);
      const seatsPayload = await seatsRes.json();
      const plantsPayload = await plantsRes.json();

      if (!seatsRes.ok) {
        throw new Error(seatsPayload.error || "Failed to load seats");
      }
      if (!plantsRes.ok) {
        throw new Error(plantsPayload.error || "Failed to load plants");
      }

      setSummary(seatsPayload.summary || { allocated: 0, active: 0, pending: 0, remaining: 0 });
      if (subscriptionSummary) {
        setSummary((prev) => ({
          ...prev,
          allocated: subscriptionSummary.entitlement?.limits?.seat ?? prev.allocated,
          remaining: subscriptionSummary.entitlement?.remaining?.seat ?? prev.remaining,
          blocked: subscriptionSummary.decisions?.seats?.blocked ?? prev.blocked,
          reason: subscriptionSummary.decisions?.seats?.code ?? prev.reason,
        }));
      }
      setRows(seatsPayload.seats || []);
      setPlants(plantsPayload.plants || []);
    } catch (err: any) {
      setError(err?.message || "Unable to load seat data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!subscriptionSummary) return;
    setSummary((prev) => ({
      ...prev,
      allocated: subscriptionSummary.entitlement?.limits?.seat ?? prev.allocated,
      remaining: subscriptionSummary.entitlement?.remaining?.seat ?? prev.remaining,
      blocked: subscriptionSummary.decisions?.seats?.blocked ?? prev.blocked,
      reason: subscriptionSummary.decisions?.seats?.code ?? prev.reason,
    }));
  }, [subscriptionSummary]);

  async function handleInviteSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    setInviteUrl(null);
    try {
      const res = await fetch("/api/company/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to send invite");
      }

      setSuccess(payload.email_sent ? "Invite sent successfully." : "Invite created. Email sending failed.");
      setInviteUrl(payload.invite_url || null);
      setForm({
        full_name: "",
        email: "",
        role: "operator",
        plant_ids: [],
      });
      setModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setError(err?.message || "Unable to send invite");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateSeat(seatId: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/user/seats/${seatId}/deactivate`, {
        method: "POST",
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to deactivate seat");
      }
      setSuccess("Seat deactivated.");
      await fetchData();
    } catch (err: any) {
      setError(err?.message || "Unable to deactivate seat");
    }
  }

  function togglePlantSelection(plantId: string) {
    setForm((prev) => {
      if (prev.plant_ids.includes(plantId)) {
        return {
          ...prev,
          plant_ids: prev.plant_ids.filter((id) => id !== plantId),
        };
      }
      return {
        ...prev,
        plant_ids: [...prev.plant_ids, plantId],
      };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Seat Management</h1>
          <p className="text-sm text-gray-500">
            Manage company user seats, invite members, and map them to active plants.
          </p>
        </div>
        <Button
          onClick={() => setModalOpen(true)}
          disabled={Boolean(summary.blocked) || plants.length === 0}
        >
          Invite User
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Allocated Seats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.allocated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active Seats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Remaining Seats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.remaining}</p>
            <p className="mt-1 text-xs text-gray-500">
              {summary.pending} pending invite{summary.pending === 1 ? "" : "s"}.
            </p>
          </CardContent>
        </Card>
      </div>

      {summary.blocked && (
        <p className="text-sm text-rose-600">
          Seat invites blocked: {summary.reason || "quota_exceeded"}
        </p>
      )}
      {success && <p className="text-sm text-green-700">{success}</p>}
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {inviteUrl && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Invite link: <span className="font-mono break-all">{inviteUrl}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Seats</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500">Loading seats...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">No seats yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Email</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Plants</th>
                    <th className="px-2 py-2">Invite</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((seat) => (
                    <tr key={seat.id} className="border-t border-gray-100">
                      <td className="px-2 py-2">{seat.full_name || "-"}</td>
                      <td className="px-2 py-2">{seat.email || "-"}</td>
                      <td className="px-2 py-2">{seat.status || "-"}</td>
                      <td className="px-2 py-2">
                        {seat.assigned_plants?.length
                          ? seat.assigned_plants.map((plant) => plant.name || plant.id).join(", ")
                          : "-"}
                      </td>
                      <td className="px-2 py-2">
                        {seat.invitation
                          ? `${seat.invitation.status}${seat.invitation.expires_at ? ` (exp ${new Date(seat.invitation.expires_at).toLocaleDateString()})` : ""}`
                          : "-"}
                      </td>
                      <td className="px-2 py-2">
                        {seat.status !== "deactivated" && (
                          <Button
                            variant="destructive"
                            onClick={() => handleDeactivateSeat(seat.id)}
                            className="h-8 px-2 text-xs"
                          >
                            Deactivate
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Invite User</h2>
              <button
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setModalOpen(false)}
              >
                Close
              </button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={handleInviteSubmit}>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Full Name</label>
                <Input
                  value={form.full_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, full_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Email</label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, email: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Role</label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={form.role}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, role: event.target.value }))
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Assign Plant IDs</label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {plants.length === 0 ? (
                    <p className="text-sm text-gray-500">No active plants available.</p>
                  ) : (
                    plants.map((plant) => (
                      <label key={plant.id} className="flex items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedPlants.has(plant.id)}
                          onChange={() => togglePlantSelection(plant.id)}
                        />
                        <span>{plant.name}</span>
                        <span className="text-xs text-gray-400">({plant.id})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving || form.plant_ids.length === 0 || Boolean(summary.blocked)}
                >
                  {saving ? "Sending..." : "Send Invite"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

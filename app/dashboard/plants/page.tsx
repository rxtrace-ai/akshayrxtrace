"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useSubscriptionSummary } from "@/lib/hooks/useSubscriptionSummary";

type PlantRow = {
  id: string;
  name: string;
  street_address: string;
  city_state: string;
  location_description?: string | null;
  status: "active" | "deactivated";
  activated_at: string | null;
  created_at: string;
};

type PlantSummary = {
  allocated: number;
  active: number;
  remaining: number;
  blocked?: boolean;
  reason?: string | null;
};

export default function DashboardPlantsPage() {
  const [plants, setPlants] = useState<PlantRow[]>([]);
  const [summary, setSummary] = useState<PlantSummary>({
    allocated: 0,
    active: 0,
    remaining: 0,
  });
  const { data: subscriptionSummary } = useSubscriptionSummary();
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    street_address: "",
    city_state: "",
    location_description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchPlants = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/user/plants");
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load plants");
      }
      setPlants(payload.plants || []);
      const activeCount = payload.summary?.active ?? payload.plants?.filter((p: any) => p.status === "active")?.length ?? 0;
      const allocated = subscriptionSummary?.entitlement?.limits?.plant ?? payload.summary?.allocated ?? 0;
      const remaining = subscriptionSummary?.entitlement?.remaining?.plant ?? payload.summary?.remaining ?? Math.max(allocated - activeCount, 0);
      const blocked = subscriptionSummary?.decisions?.plants?.blocked ?? false;
      const reason = subscriptionSummary?.decisions?.plants?.code ?? null;
      setSummary({
        allocated,
        active: activeCount,
        remaining,
        blocked,
        reason,
      });
    } catch (err: any) {
      setError(err?.message || "Unable to load plant data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlants();
  }, []);

  useEffect(() => {
    if (!subscriptionSummary) return;
    setSummary((prev) => ({
      ...prev,
      allocated: subscriptionSummary.entitlement?.limits?.plant ?? prev.allocated,
      remaining: subscriptionSummary.entitlement?.remaining?.plant ?? prev.remaining,
      blocked: subscriptionSummary.decisions?.plants?.blocked ?? prev.blocked,
      reason: subscriptionSummary.decisions?.plants?.code ?? prev.reason,
    }));
  }, [subscriptionSummary]);

  const handleActivate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/user/plants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to activate plant");
      }
      setForm({ name: "", street_address: "", city_state: "", location_description: "" });
      setModalOpen(false);
      await fetchPlants();
    } catch (err: any) {
      setError(err?.message || "Unable to activate plant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Plant Management</h1>
          <p className="text-sm text-gray-500 max-w-xl">
            All plants belong to your company tenant. Activate new plants once the trial or paid quota allows.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)} disabled={Boolean(summary.blocked)}>
          Activate Plant
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Allocated</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.allocated}</p>
            <p className="text-sm text-gray-500">Total plants allowed by entitlement</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.active}</p>
            <p className="text-sm text-gray-500">Plants ready to receive seat invites</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{summary.remaining}</p>
            <p className="text-sm text-gray-500">Quota remaining (trial/plan)</p>
          </CardContent>
        </Card>
      </div>
      {summary.blocked && (
        <p className="text-sm text-rose-600">
          Plant activation blocked: {summary.reason || "quota_exceeded"}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Plants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading plants...</p>
          ) : plants.length === 0 ? (
            <p className="text-sm text-gray-500">No plants activated yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400">
                  <tr>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Address</th>
                    <th className="px-2 py-2">Location</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {plants.map((plant) => (
                    <tr key={plant.id} className="border-t border-gray-100">
                      <td className="px-2 py-2">{plant.name}</td>
                      <td className="px-2 py-2">
                        {plant.street_address}, {plant.city_state}
                      </td>
                      <td className="px-2 py-2">{plant.location_description || "-"}</td>
                      <td className="px-2 py-2">
                        <Badge
                          className={
                            plant.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                          }
                        >
                          {plant.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        {plant.activated_at
                          ? new Date(plant.activated_at).toLocaleDateString()
                          : "-"}
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
              <h2 className="text-xl font-semibold">Activate Plant</h2>
              <button
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setModalOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Provide the plant details that will appear on your invite flows.
            </p>
            <form className="mt-6 space-y-4" onSubmit={handleActivate}>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Plant Name</label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Complete Address</label>
                <Textarea
                  value={form.street_address}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, street_address: event.target.value }))
                  }
                  rows={3}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">City / State</label>
                <Input
                  value={form.city_state}
                  onChange={(event) => setForm((prev) => ({ ...prev, city_state: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Location Description</label>
                <Textarea
                  value={form.location_description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, location_description: event.target.value }))
                  }
                  rows={2}
                  placeholder="E.g., Warehouse 3 / Site A"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || Boolean(summary.blocked)}>
                  {saving ? "Activating..." : "Activate Plant"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

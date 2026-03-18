"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Coupon = {
  id: string;
  code: string;
  discount_type: "flat" | "percentage";
  discount_value: number;
  max_discount_paise: number | null;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  used_count: number;
  created_at?: string | null;
};

type CouponsResponse = {
  success: boolean;
  coupons: Coupon[];
  error?: string;
};

export default function AdminDiscountsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: "",
    discount_type: "flat",
    discount_value: "",
    max_discount_paise: "",
    active: true,
  });

  const editingCoupon = useMemo(() => coupons.find((c) => c.id === editingId) || null, [coupons, editingId]);

  const loadCoupons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/coupons", { cache: "no-store" });
      const payload = (await res.json()) as CouponsResponse;
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load coupons");
      }
      setCoupons(payload.coupons || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load coupons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoupons();
  }, [loadCoupons]);

  async function createCoupon() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          code: form.code,
          discount_type: form.discount_type,
          discount_value: Math.max(0, Math.trunc(Number(form.discount_value || 0))),
          max_discount_paise: form.max_discount_paise === "" ? null : Math.max(0, Math.trunc(Number(form.max_discount_paise))),
          active: form.active,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Failed to create coupon");
      }

      setForm({
        code: "",
        discount_type: "flat",
        discount_value: "",
        max_discount_paise: "",
        active: true,
      });
      setMessage("Coupon created.");
      await loadCoupons();
    } catch (err: any) {
      setError(err?.message || "Failed to create coupon");
    } finally {
      setSaving(false);
    }
  }

  async function updateCoupon() {
    if (!editingCoupon) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/coupons/${editingCoupon.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          code: form.code,
          discount_type: form.discount_type,
          discount_value: Math.max(0, Math.trunc(Number(form.discount_value || 0))),
          max_discount_paise: form.max_discount_paise === "" ? null : Math.max(0, Math.trunc(Number(form.max_discount_paise))),
          active: form.active,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Failed to update coupon");
      }
      setMessage("Coupon updated.");
      setEditingId(null);
      setForm({ code: "", discount_type: "flat", discount_value: "", max_discount_paise: "", active: true });
      await loadCoupons();
    } catch (err: any) {
      setError(err?.message || "Failed to update coupon");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(coupon: Coupon) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/coupons/${coupon.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ active: !coupon.active }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || payload.error || "Failed to update status");
      }
      setMessage(`Coupon ${coupon.active ? "deactivated" : "activated"}.`);
      await loadCoupons();
    } catch (err: any) {
      setError(err?.message || "Failed to update coupon status");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(coupon: Coupon) {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: String(coupon.discount_value),
      max_discount_paise: coupon.max_discount_paise == null ? "" : String(coupon.max_discount_paise),
      active: coupon.active,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#0052CC]">Coupons</h1>
        <p className="mt-1 text-sm text-gray-600">Admin-managed backend coupons for quote pricing.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit Coupon" : "Create Coupon"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Code</p>
            <Input
              value={form.code}
              placeholder="WELCOME10"
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Discount Type</p>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.discount_type}
              onChange={(e) => setForm((prev) => ({ ...prev, discount_type: e.target.value as "flat" | "percentage" }))}
            >
              <option value="flat">Flat (paise)</option>
              <option value="percentage">Percentage</option>
            </select>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Discount Value</p>
            <Input
              type="number"
              min={0}
              value={form.discount_value}
              onChange={(e) => setForm((prev) => ({ ...prev, discount_value: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Max Discount (paise)</p>
            <Input
              type="number"
              min={0}
              placeholder="Optional"
              value={form.max_discount_paise}
              onChange={(e) => setForm((prev) => ({ ...prev, max_discount_paise: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
            Active
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            {editingId ? (
              <Button type="button" variant="outline" onClick={() => {
                setEditingId(null);
                setForm({ code: "", discount_type: "flat", discount_value: "", max_discount_paise: "", active: true });
              }}>
                Cancel
              </Button>
            ) : null}
            <Button onClick={editingId ? updateCoupon : createCoupon} disabled={saving || !form.code.trim() || !form.discount_value}>
              {saving ? "Saving..." : editingId ? "Update Coupon" : "Create Coupon"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Coupons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-gray-500">Loading coupons...</p> : null}
          {!loading && coupons.length === 0 ? <p className="text-sm text-gray-500">No coupons created yet.</p> : null}
          {coupons.map((coupon) => (
            <div key={coupon.id} className="rounded-lg border p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{coupon.code}</p>
                  <p className="text-gray-500">
                    {coupon.discount_type} {coupon.discount_value}
                    {coupon.discount_type === "percentage" ? "%" : " paise"}
                  </p>
                  <p className="text-xs text-gray-500">
                    max cap: {coupon.max_discount_paise ?? "none"} · used: {coupon.used_count}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={coupon.active ? "text-emerald-700" : "text-gray-500"}>
                    {coupon.active ? "Active" : "Inactive"}
                  </span>
                  <Button type="button" variant="outline" onClick={() => startEdit(coupon)} disabled={saving}>
                    Edit
                  </Button>
                  <Button type="button" variant="outline" onClick={() => toggleStatus(coupon)} disabled={saving}>
                    {coupon.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

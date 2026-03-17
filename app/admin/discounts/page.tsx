"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Coupon = {
  id: string;
  code: string;
  type: "flat" | "percentage";
  value: number;
  is_active: boolean;
  scope: "subscription" | "addons" | "both";
  metadata?: {
    max_discount?: number | null;
  } | null;
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
  const [form, setForm] = useState({
    code: "",
    discount_type: "flat",
    discount_value: "",
    max_discount: "",
    active: true,
  });

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
      const res = await fetch("/api/admin/coupons/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          code: form.code,
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value || 0),
          max_discount: form.max_discount === "" ? null : Number(form.max_discount),
          is_active: form.active,
          scope: "addons",
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
        max_discount: "",
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#0052CC]">Discounts</h1>
        <p className="mt-1 text-sm text-gray-600">Create and manage checkout coupons for add-on payments.</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Create Coupon</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Code</p>
            <Input
              value={form.code}
              placeholder="WELCOME100"
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Discount Type</p>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.discount_type}
              onChange={(e) => setForm((prev) => ({ ...prev, discount_type: e.target.value }))}
            >
              <option value="flat">Flat</option>
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
            <p className="text-sm font-medium text-gray-700">Max Discount</p>
            <Input
              type="number"
              min={0}
              placeholder="Optional cap in INR"
              value={form.max_discount}
              onChange={(e) => setForm((prev) => ({ ...prev, max_discount: e.target.value }))}
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
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={createCoupon} disabled={saving || !form.code.trim() || !form.discount_value}>
              {saving ? "Creating..." : "Create Coupon"}
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
                    {coupon.type} {coupon.value}
                    {coupon.type === "percentage" ? "%" : " INR"} · scope {coupon.scope}
                  </p>
                </div>
                <div className={coupon.is_active ? "text-emerald-700" : "text-gray-500"}>
                  {coupon.is_active ? "Active" : "Inactive"}
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Max discount: {coupon.metadata?.max_discount ?? "none"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

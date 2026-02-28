'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Plus, Edit2, Ban, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CouponScope = 'subscription' | 'addons' | 'both';

type Coupon = {
  id: string;
  code: string;
  type: 'percentage' | 'flat';
  value: number;
  valid_from: string;
  valid_to: string | null;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  scope: CouponScope;
  razorpay_offer_id?: string | null;
};

type CouponFormState = {
  code: string;
  type: 'percentage' | 'flat';
  value: string;
  valid_from: string;
  valid_to: string;
  usage_limit: string;
  scope: CouponScope;
  razorpay_offer_id: string;
};

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toFormState(coupon: Coupon | null): CouponFormState {
  return {
    code: coupon?.code || '',
    type: coupon?.type || 'percentage',
    value: String(coupon?.value ?? 0),
    valid_from: coupon?.valid_from ? coupon.valid_from.slice(0, 10) : new Date().toISOString().slice(0, 10),
    valid_to: coupon?.valid_to ? coupon.valid_to.slice(0, 10) : '',
    usage_limit: coupon?.usage_limit === null || coupon?.usage_limit === undefined ? '' : String(coupon.usage_limit),
    scope: coupon?.scope || 'both',
    razorpay_offer_id: coupon?.razorpay_offer_id || '',
  };
}

function validateForm(form: CouponFormState): string | null {
  if (!form.code.trim()) return 'Coupon code is required';
  const value = Number(form.value);
  if (!Number.isFinite(value) || value < 0) return 'Value must be a non-negative number';
  if (form.type === 'percentage' && value > 100) return 'Percentage cannot be greater than 100';

  const from = new Date(form.valid_from);
  if (Number.isNaN(from.getTime())) return 'Valid from date is invalid';
  if (form.valid_to) {
    const to = new Date(form.valid_to);
    if (Number.isNaN(to.getTime())) return 'Valid to date is invalid';
    if (to.getTime() < from.getTime()) return 'Valid to must be after valid from';
  }

  if (form.usage_limit) {
    const limit = Number(form.usage_limit);
    if (!Number.isFinite(limit) || limit < 0) return 'Usage limit must be empty or a non-negative number';
  }

  const offerId = form.razorpay_offer_id.trim();
  if (offerId && !/^offer_[a-zA-Z0-9]+$/.test(offerId)) {
    return 'Razorpay Offer ID must be in format offer_xxx';
  }
  return null;
}

function normalizePayload(form: CouponFormState) {
  return {
    code: form.code.trim().toUpperCase(),
    type: form.type,
    value: Number(form.value),
    valid_from: new Date(form.valid_from).toISOString(),
    valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
    usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
    scope: form.scope,
    razorpay_offer_id: form.razorpay_offer_id.trim() || null,
  };
}

export default function AdminCouponsPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CouponFormState>(toFormState(null));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchCoupons() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/coupons', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to fetch coupons');
      }
      setCoupons(data.coupons || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch coupons');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCoupons();
  }, []);

  function openCreateForm() {
    setEditingCoupon(null);
    setForm(toFormState(null));
    setShowForm(true);
    setMessage(null);
    setError(null);
  }

  function openEditForm(coupon: Coupon) {
    setEditingCoupon(coupon);
    setForm(toFormState(coupon));
    setShowForm(true);
    setMessage(null);
    setError(null);
  }

  async function saveCoupon() {
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const method = editingCoupon ? 'PUT' : 'POST';
      const payload = normalizePayload(form);
      const body = editingCoupon ? { ...payload, id: editingCoupon.id } : payload;

      const res = await fetch('/api/admin/coupons', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to save coupon');
      }

      setMessage(editingCoupon ? 'Coupon updated' : 'Coupon created');
      setShowForm(false);
      setEditingCoupon(null);
      await fetchCoupons();
    } catch (err: any) {
      setError(err?.message || 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  }

  async function toggleCoupon(coupon: Coupon) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({ id: coupon.id, is_active: !coupon.is_active }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to update coupon');
      }
      setMessage(`Coupon ${coupon.is_active ? 'deactivated' : 'activated'}`);
      await fetchCoupons();
    } catch (err: any) {
      setError(err?.message || 'Failed to update coupon');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#0052CC]">Coupons</h1>
          <p className="text-gray-600 mt-1">Coupon controls with scope and Razorpay offer validation.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchCoupons} disabled={loading || saving} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateForm} disabled={saving}>
            <Plus className="w-4 h-4 mr-2" />
            New Coupon
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingCoupon ? 'Edit Coupon' : 'Create Coupon'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Coupon Code *</Label>
              <Input value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.type}
                  onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as 'percentage' | 'flat' }))}
                >
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input type="number" min={0} value={form.value} onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value as CouponScope }))}
                >
                  <option value="both">Both</option>
                  <option value="subscription">Subscription</option>
                  <option value="addons">Add-ons</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Valid From</Label>
                <Input type="date" value={form.valid_from} onChange={(e) => setForm((prev) => ({ ...prev, valid_from: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Valid To</Label>
                <Input type="date" value={form.valid_to} onChange={(e) => setForm((prev) => ({ ...prev, valid_to: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Usage Limit</Label>
                <Input type="number" min={0} value={form.usage_limit} onChange={(e) => setForm((prev) => ({ ...prev, usage_limit: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Razorpay Offer ID</Label>
              <Input
                placeholder="offer_xxx"
                value={form.razorpay_offer_id}
                onChange={(e) => setForm((prev) => ({ ...prev, razorpay_offer_id: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveCoupon} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {coupons.map((coupon) => (
          <Card key={coupon.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg">{coupon.code}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditForm(coupon)} disabled={saving}>
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleCoupon(coupon)} disabled={saving}>
                    {coupon.is_active ? <Ban className="w-4 h-4 mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    {coupon.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-gray-700 space-y-1">
              <p><strong>Type:</strong> {coupon.type === 'percentage' ? `${coupon.value}%` : `₹${coupon.value}`}</p>
              <p><strong>Scope:</strong> {coupon.scope || 'both'}</p>
              <p><strong>Validity:</strong> {new Date(coupon.valid_from).toLocaleDateString('en-IN')} - {coupon.valid_to ? new Date(coupon.valid_to).toLocaleDateString('en-IN') : 'No expiry'}</p>
              <p><strong>Usage:</strong> {coupon.usage_count}{coupon.usage_limit ? ` / ${coupon.usage_limit}` : ' / Unlimited'}</p>
              {coupon.razorpay_offer_id ? <p><strong>Razorpay Offer ID:</strong> {coupon.razorpay_offer_id}</p> : null}
              <p><strong>Status:</strong> {coupon.is_active ? 'Active' : 'Inactive'}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


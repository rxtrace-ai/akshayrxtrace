'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Plus, Edit2, Save } from 'lucide-react';

type AddOnKind = 'structural' | 'variable_quota';
type EntitlementKey = 'seat' | 'plant' | 'handset' | 'unit' | 'box' | 'carton' | 'pallet';
type BillingMode = 'recurring' | 'one_time';

type AddOn = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  recurring: boolean;
  is_active: boolean;
  display_order: number;
  addon_kind: AddOnKind;
  entitlement_key: EntitlementKey;
  billing_mode: BillingMode;
  razorpay_item_id: string | null;
};

type AddOnFormState = {
  name: string;
  description: string;
  price: string;
  unit: string;
  display_order: string;
  is_active: boolean;
  addon_kind: AddOnKind;
  entitlement_key: EntitlementKey;
  billing_mode: BillingMode;
  razorpay_item_id: string;
};

const STRUCTURAL_KEYS: EntitlementKey[] = ['seat', 'plant', 'handset'];
const VARIABLE_KEYS: EntitlementKey[] = ['unit', 'box', 'carton', 'pallet'];

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toFormState(addOn: AddOn | null): AddOnFormState {
  if (!addOn) {
    return {
      name: '',
      description: '',
      price: '0',
      unit: 'unit',
      display_order: '0',
      is_active: true,
      addon_kind: 'variable_quota',
      entitlement_key: 'unit',
      billing_mode: 'one_time',
      razorpay_item_id: '',
    };
  }
  return {
    name: addOn.name || '',
    description: addOn.description || '',
    price: String(addOn.price ?? 0),
    unit: addOn.unit || 'unit',
    display_order: String(addOn.display_order ?? 0),
    is_active: addOn.is_active,
    addon_kind: addOn.addon_kind || 'variable_quota',
    entitlement_key: addOn.entitlement_key || 'unit',
    billing_mode: addOn.billing_mode || (addOn.recurring ? 'recurring' : 'one_time'),
    razorpay_item_id: addOn.razorpay_item_id || '',
  };
}

function validateForm(form: AddOnFormState): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (!form.unit.trim()) return 'Unit is required';
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) return 'Price must be a non-negative number';
  const displayOrder = Number(form.display_order);
  if (!Number.isFinite(displayOrder) || displayOrder < 0) return 'Display order must be a non-negative number';

  if (form.addon_kind === 'structural' && !STRUCTURAL_KEYS.includes(form.entitlement_key)) {
    return 'Structural add-ons require entitlement key seat/plant/handset';
  }
  if (form.addon_kind === 'variable_quota' && !VARIABLE_KEYS.includes(form.entitlement_key)) {
    return 'Variable quota add-ons require entitlement key unit/box/carton/pallet';
  }
  return null;
}

function normalizePayload(form: AddOnFormState) {
  const price = Number(form.price);
  const displayOrder = Number(form.display_order);
  const recurring = form.billing_mode === 'recurring';
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    price: Number.isFinite(price) ? price : 0,
    unit: form.unit.trim(),
    display_order: Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
    is_active: form.is_active,
    addon_kind: form.addon_kind,
    entitlement_key: form.entitlement_key,
    billing_mode: form.billing_mode,
    recurring,
    razorpay_item_id: form.razorpay_item_id.trim() || null,
  };
}

export default function AdminAddOnsPage() {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddOnFormState>(toFormState(null));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAddOns();
  }, []);

  async function fetchAddOns() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/addons', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to fetch add-ons');
      }
      setAddOns(data.add_ons || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch add-ons');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingAddOn(null);
    setForm(toFormState(null));
    setShowForm(true);
    setMessage(null);
    setError(null);
  }

  function openEdit(addOn: AddOn) {
    setEditingAddOn(addOn);
    setForm(toFormState(addOn));
    setShowForm(true);
    setMessage(null);
    setError(null);
  }

  async function handleSave() {
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const method = editingAddOn ? 'PUT' : 'POST';
      const payload = normalizePayload(form);
      const body = editingAddOn ? { ...payload, id: editingAddOn.id } : payload;

      const res = await fetch('/api/admin/addons', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to save add-on');
      }

      setMessage(editingAddOn ? 'Add-on updated' : 'Add-on created');
      setShowForm(false);
      setEditingAddOn(null);
      await fetchAddOns();
    } catch (err: any) {
      setError(err?.message || 'Failed to save add-on');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(addOn: AddOn) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/addons', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({ id: addOn.id, is_active: !addOn.is_active }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to update add-on');
      }
      setMessage(`Add-on ${addOn.is_active ? 'disabled' : 'enabled'}`);
      await fetchAddOns();
    } catch (err: any) {
      setError(err?.message || 'Failed to update add-on');
    } finally {
      setSaving(false);
    }
  }

  const entitlementOptions = form.addon_kind === 'structural' ? STRUCTURAL_KEYS : VARIABLE_KEYS;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-[#0052CC]">Add-ons</h1>
          <p className="text-gray-600 mt-1">Canonical add-on editor with kind, entitlement key, and billing mode.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchAddOns} disabled={loading || saving} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreate} disabled={saving}>
            <Plus className="w-4 h-4 mr-2" />
            New Add-on
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingAddOn ? 'Edit Add-on' : 'Create Add-on'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Unit *</Label>
                <Input value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Price (INR) *</Label>
                <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Display Order</Label>
                <Input type="number" min={0} value={form.display_order} onChange={(e) => setForm((prev) => ({ ...prev, display_order: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Addon Kind</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.addon_kind}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      addon_kind: e.target.value as AddOnKind,
                      entitlement_key: e.target.value === 'structural' ? 'seat' : 'unit',
                      billing_mode: e.target.value === 'structural' ? 'recurring' : 'one_time',
                    }))
                  }
                >
                  <option value="structural">Structural</option>
                  <option value="variable_quota">Variable Quota</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Entitlement Key</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.entitlement_key}
                  onChange={(e) => setForm((prev) => ({ ...prev, entitlement_key: e.target.value as EntitlementKey }))}
                >
                  {entitlementOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Billing Mode</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.billing_mode}
                  onChange={(e) => setForm((prev) => ({ ...prev, billing_mode: e.target.value as BillingMode }))}
                >
                  <option value="recurring">Recurring</option>
                  <option value="one_time">One Time</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Razorpay Item ID</Label>
                <Input
                  placeholder="item_xxx"
                  value={form.razorpay_item_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, razorpay_item_id: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="addon-active"
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              <Label htmlFor="addon-active">Active</Label>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {addOns.map((addOn) => (
          <Card key={addOn.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {addOn.name}
                    <Badge variant={addOn.is_active ? 'default' : 'secondary'}>{addOn.is_active ? 'Active' : 'Inactive'}</Badge>
                    <Badge variant="outline">{addOn.addon_kind}</Badge>
                    <Badge variant="outline">{addOn.billing_mode}</Badge>
                  </CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    {addOn.description || 'No description'} • ₹{Number(addOn.price || 0).toLocaleString('en-IN')} / {addOn.unit}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    entitlement: {addOn.entitlement_key}
                    {addOn.razorpay_item_id ? ` • razorpay_item_id: ${addOn.razorpay_item_id}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(addOn)} disabled={saving}>
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleToggleActive(addOn)} disabled={saving}>
                    {addOn.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}


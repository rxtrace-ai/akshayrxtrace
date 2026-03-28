'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Plus } from 'lucide-react';

type AddOnKind = 'structural' | 'variable_quota';
type EntitlementKey = 'seat' | 'plant' | 'handset' | 'unit' | 'box' | 'carton' | 'pallet';
type BillingMode = 'recurring' | 'one_time';

type AddOn = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  pricing_unit_size: number;
  recurring: boolean;
  is_active: boolean;
  display_order: number;
  duration_days: number | null;
  addon_kind: AddOnKind;
  entitlement_key: EntitlementKey;
  billing_mode: BillingMode;
};

type AddOnFormState = {
  name: string;
  description: string;
  price: string;
  unit: string;
  pricing_unit_size: string;
  display_order: string;
  duration_days: string;
  is_active: boolean;
  addon_kind: AddOnKind;
  entitlement_key: EntitlementKey;
};

const CAPACITY_KEYS: EntitlementKey[] = ['seat', 'plant', 'handset'];
const CODE_KEYS: EntitlementKey[] = ['unit', 'box', 'carton', 'pallet'];

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
        pricing_unit_size: '10000',
        display_order: '0',
        duration_days: '30',
        is_active: true,
        addon_kind: 'variable_quota',
        entitlement_key: 'unit',
      };
  }
  return {
    name: addOn.name || '',
    description: addOn.description || '',
    price: String(addOn.price ?? 0),
    unit: addOn.unit || 'unit',
    pricing_unit_size: String(addOn.pricing_unit_size ?? 1),
    display_order: String(addOn.display_order ?? 0),
    duration_days: addOn.duration_days == null ? '30' : String(addOn.duration_days),
    is_active: addOn.is_active,
    addon_kind: addOn.addon_kind || 'variable_quota',
    entitlement_key: addOn.entitlement_key || 'unit',
  };
}

function validateForm(form: AddOnFormState): string | null {
  if (!form.name.trim()) return 'Name is required';
  if (!form.unit.trim()) return 'Unit is required';
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) return 'Price must be a non-negative number';
  const displayOrder = Number(form.display_order);
  if (!Number.isFinite(displayOrder) || displayOrder < 0) return 'Display order must be a non-negative number';
  const pricingUnitSize = Number(form.pricing_unit_size);
  if (!Number.isFinite(pricingUnitSize) || pricingUnitSize <= 0) return 'Pricing unit size must be greater than zero';
  const durationDays = Number(form.duration_days);

  if (form.addon_kind === 'structural' && !CAPACITY_KEYS.includes(form.entitlement_key)) {
    return 'Capacity add-ons require seat/plant/handset';
  }
  if (form.addon_kind === 'variable_quota' && !CODE_KEYS.includes(form.entitlement_key)) {
    return 'Code add-ons require unit/box/carton/pallet';
  }
  if (form.addon_kind === 'structural' && ![30, 60, 90].includes(durationDays)) {
    return 'Capacity add-ons require duration 30, 60, or 90 days';
  }
  return null;
}

function normalizePayload(form: AddOnFormState) {
  const price = Number(form.price);
  const displayOrder = Number(form.display_order);
  const isCapacity = form.addon_kind === 'structural';
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    price: Number.isFinite(price) ? price : 0,
    unit: form.unit.trim(),
    pricing_unit_size: Math.max(1, Math.trunc(Number(form.pricing_unit_size) || 1)),
    display_order: Number.isFinite(displayOrder) ? Math.trunc(displayOrder) : 0,
    duration_days: isCapacity ? Math.max(30, Math.trunc(Number(form.duration_days) || 30)) : null,
    is_active: form.is_active,
    addon_kind: form.addon_kind,
    entitlement_key: form.entitlement_key,
    billing_mode: isCapacity ? 'recurring' : 'one_time',
    recurring: isCapacity,
  };
}

function buildCatalogExample(form: AddOnFormState) {
  const price = Number(form.price || 0);
  if (form.addon_kind === 'structural') {
    return `1 ${form.unit || 'unit'} = 1 ${form.entitlement_key} for ${form.duration_days || '30'} days @ INR ${Number.isFinite(price) ? price : 0}`;
  }
  return `1 ${form.unit || 'unit'} = ${Math.max(1, Math.trunc(Number(form.pricing_unit_size) || 1)).toLocaleString()} ${form.entitlement_key} codes @ INR ${Number.isFinite(price) ? price : 0}`;
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

  const entitlementOptions = form.addon_kind === 'structural' ? CAPACITY_KEYS : CODE_KEYS;
  const codeAddOns = useMemo(() => addOns.filter((row) => row.addon_kind === 'variable_quota'), [addOns]);
  const capacityAddOns = useMemo(() => addOns.filter((row) => row.addon_kind === 'structural'), [addOns]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#0052CC]">Add-ons</h1>
          <p className="mt-1 text-gray-600">Admin-managed code top-ups and time-bound capacity add-ons.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchAddOns} disabled={loading || saving} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreate} disabled={saving}>
            <Plus className="mr-2 h-4 w-4" />
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Add-on Type</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.addon_kind}
                  onChange={(e) => {
                    const addonKind = e.target.value as AddOnKind;
                    setForm((prev) => ({
                      ...prev,
                      addon_kind: addonKind,
                      entitlement_key: addonKind === 'structural' ? 'seat' : 'unit',
                      duration_days: addonKind === 'structural' ? '30' : prev.duration_days,
                      pricing_unit_size: addonKind === 'structural' ? '1' : prev.pricing_unit_size,
                    }));
                  }}
                >
                  <option value="variable_quota">Code Add-on</option>
                  <option value="structural">Capacity Add-on</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Entitlement Key</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.entitlement_key}
                  onChange={(e) => setForm((prev) => ({ ...prev, entitlement_key: e.target.value as EntitlementKey }))}
                >
                  {entitlementOptions.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Price (INR)</Label>
                <Input type="number" min={0} value={form.price} onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Purchase Model</Label>
                <Input
                  value={form.addon_kind === 'structural' ? 'Time-bound capacity add-on' : 'One-time code top-up'}
                  readOnly
                  disabled
                />
              </div>
              <div className="space-y-2">
                <Label>Unit Label</Label>
                <Input value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{form.addon_kind === 'structural' ? 'Quantity Per Unit' : 'Codes Per Unit'}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.pricing_unit_size}
                  onChange={(e) => setForm((prev) => ({ ...prev, pricing_unit_size: e.target.value }))}
                  disabled={form.addon_kind === 'structural'}
                />
                <p className="text-xs text-gray-500">
                  {form.addon_kind === 'structural'
                    ? 'Capacity add-ons always grant one entitlement per purchased unit.'
                    : 'For code add-ons, 1 purchased unit grants this many codes.'}
                </p>
              </div>
              {form.addon_kind === 'structural' ? (
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.duration_days}
                    onChange={(e) => setForm((prev) => ({ ...prev, duration_days: e.target.value }))}
                  >
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                  </select>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Display Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.display_order}
                  onChange={(e) => setForm((prev) => ({ ...prev, display_order: e.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-md border bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Catalog Preview</p>
              <p className="mt-1">{buildCatalogExample(form)}</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingAddOn ? 'Update Add-on' : 'Create Add-on'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Code Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {codeAddOns.map((addOn) => (
              <div key={addOn.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{addOn.name}</p>
                    <p className="text-xs text-gray-500">
                      {addOn.entitlement_key} • {addOn.pricing_unit_size.toLocaleString()} codes per unit • INR {addOn.price}
                    </p>
                  </div>
                  <Badge variant={addOn.is_active ? 'default' : 'secondary'}>
                    {addOn.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {addOn.description ? <p className="mt-2 text-sm text-gray-600">{addOn.description}</p> : null}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(addOn)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => handleToggleActive(addOn)}>
                    {addOn.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            ))}
            {codeAddOns.length === 0 ? <p className="text-sm text-gray-500">No code add-ons configured.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capacity Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {capacityAddOns.map((addOn) => (
              <div key={addOn.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{addOn.name}</p>
                    <p className="text-xs text-gray-500">
                      {addOn.entitlement_key} • recurring • INR {addOn.price}
                    </p>
                  </div>
                  <Badge variant={addOn.is_active ? 'default' : 'secondary'}>
                    {addOn.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {addOn.description ? <p className="mt-2 text-sm text-gray-600">{addOn.description}</p> : null}
                <p className="mt-2 text-xs text-slate-600">
                  Duration: {addOn.duration_days ?? 30} days. Purchase unit: {addOn.unit}.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(addOn)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => handleToggleActive(addOn)}>
                    {addOn.is_active ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            ))}
            {capacityAddOns.length === 0 ? <p className="text-sm text-gray-500">No capacity add-ons configured.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

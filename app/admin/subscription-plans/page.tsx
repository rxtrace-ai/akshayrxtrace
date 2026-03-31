'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, RefreshCw, Upload } from 'lucide-react';

type PlanVersion = {
  id: string;
  unit_quota_units: number;
  box_quota_units: number;
  carton_quota_units: number;
  pallet_quota_units: number;
  unit_limit: number;
  box_limit: number;
  carton_limit: number;
  pallet_limit: number;
  seat_limit: number;
  plant_limit: number;
  handset_limit: number;
  change_note: string | null;
};

type PlanTemplate = {
  id: string;
  name: string;
  description: string | null;
  billing_cycle: 'monthly' | 'yearly';
  plan_price: number;
  razorpay_plan_id: string | null;
  pricing_unit_size: number;
  is_active: boolean;
};

type PlanView = {
  template: PlanTemplate;
  active_version: PlanVersion | null;
};

type PlanPayload = {
  name: string;
  description: string;
  billing_cycle: 'monthly' | 'yearly';
  plan_price: string;
  razorpay_plan_id: string;
  pricing_unit_size: string;
  unit_quota_units: string;
  box_quota_units: string;
  carton_quota_units: string;
  pallet_quota_units: string;
  seat_limit: string;
  plant_limit: string;
  handset_limit: string;
};

const DEFAULT_PAYLOAD: PlanPayload = {
  name: '',
  description: '',
  billing_cycle: 'monthly',
  plan_price: '0',
  razorpay_plan_id: '',
  pricing_unit_size: '10000',
  unit_quota_units: '0',
  box_quota_units: '0',
  carton_quota_units: '0',
  pallet_quota_units: '0',
  seat_limit: '0',
  plant_limit: '0',
  handset_limit: '0',
};

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseNonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function formatPaiseForInput(value: number): string {
  const rupees = (value || 0) / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

function parseINRToPaise(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function formatINRFromPaise(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((value || 0) / 100);
}

function mapPlanToPayload(plan: PlanView): PlanPayload {
  const version = plan.active_version;
  return {
    name: plan.template.name,
    description: plan.template.description || '',
    billing_cycle: plan.template.billing_cycle,
    plan_price: formatPaiseForInput(plan.template.plan_price ?? 0),
    razorpay_plan_id: plan.template.razorpay_plan_id || '',
    pricing_unit_size: String(plan.template.pricing_unit_size ?? 10000),
    unit_quota_units: String(version?.unit_quota_units ?? 0),
    box_quota_units: String(version?.box_quota_units ?? 0),
    carton_quota_units: String(version?.carton_quota_units ?? 0),
    pallet_quota_units: String(version?.pallet_quota_units ?? 0),
    seat_limit: String(version?.seat_limit ?? 0),
    plant_limit: String(version?.plant_limit ?? 0),
    handset_limit: String(version?.handset_limit ?? 0),
  };
}

export default function SubscriptionPlansPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanPayload>(DEFAULT_PAYLOAD);

  async function fetchPlans() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/subscription-plans', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to fetch plans');
      }
      const nextPlans = (Array.isArray(data.plans) ? data.plans : []).map((plan: any) => ({
        template: plan.template,
        active_version: plan.active_version,
      }));
      setPlans(nextPlans);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch plans');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  function openCreateTemplate() {
    setCreatingTemplate(true);
    setEditingTemplateId(null);
    setForm(DEFAULT_PAYLOAD);
    setMessage(null);
    setError(null);
  }

  function openEditPlan(plan: PlanView) {
    setCreatingTemplate(false);
    setEditingTemplateId(plan.template.id);
    setForm(mapPlanToPayload(plan));
    setMessage(null);
    setError(null);
  }

  function closeForm() {
    setCreatingTemplate(false);
    setEditingTemplateId(null);
    setForm(DEFAULT_PAYLOAD);
  }

  async function submitForm() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const isNewTemplate = creatingTemplate;
      const res = await fetch('/api/admin/subscription-plans', {
        method: isNewTemplate ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          ...(isNewTemplate ? {} : { template_id: editingTemplateId }),
          name: form.name.trim(),
          description: form.description.trim() || null,
          billing_cycle: form.billing_cycle,
          plan_price: parseINRToPaise(form.plan_price),
          razorpay_plan_id: form.razorpay_plan_id.trim(),
          pricing_unit_size: Math.max(1, parseNonNegativeInt(form.pricing_unit_size)),
          unit_quota_units: parseNonNegativeInt(form.unit_quota_units),
          box_quota_units: parseNonNegativeInt(form.box_quota_units),
          carton_quota_units: parseNonNegativeInt(form.carton_quota_units),
          pallet_quota_units: parseNonNegativeInt(form.pallet_quota_units),
          seat_limit: parseNonNegativeInt(form.seat_limit),
          plant_limit: parseNonNegativeInt(form.plant_limit),
          handset_limit: parseNonNegativeInt(form.handset_limit),
          publish: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to save plan');
      }

      setMessage(isNewTemplate ? 'Plan created' : 'Plan updated');
      closeForm();
      await fetchPlans();
    } catch (err: any) {
      setError(err?.message || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#0052CC]">Subscription Plans</h1>
          <p className="mt-1 text-sm text-gray-600">Manage each plan as one live commercial setup without version clutter.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchPlans} disabled={loading || saving} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateTemplate} disabled={saving}>
            <Plus className="mr-2 h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {(creatingTemplate || editingTemplateId) && (
        <Card>
          <CardHeader>
            <CardTitle>{creatingTemplate ? 'Create Plan' : 'Edit Plan'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Plan Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Billing Cycle *</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={form.billing_cycle}
                  onChange={(e) => setForm((prev) => ({ ...prev, billing_cycle: e.target.value as 'monthly' | 'yearly' }))}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Plan Price (INR)</Label>
                <Input type="number" min={0} step="0.01" value={form.plan_price} onChange={(e) => setForm((prev) => ({ ...prev, plan_price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Razorpay Plan ID *</Label>
                <Input
                  value={form.razorpay_plan_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, razorpay_plan_id: e.target.value }))}
                  placeholder="plan_XXXXXXXXXXXXXX"
                />
              </div>
              <div className="space-y-2">
                <Label>Pricing Unit Size</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.pricing_unit_size}
                  onChange={(e) => setForm((prev) => ({ ...prev, pricing_unit_size: e.target.value }))}
                />
                <p className="text-xs text-gray-500">Example: 1000 means 1 quota unit equals 1,000 codes.</p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900">Live Quotas and Capacities</h3>
              <p className="mt-1 text-sm text-gray-600">Updating these values changes the current active plan directly.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                ['Unit Quota Units', 'unit_quota_units'],
                ['Box Quota Units', 'box_quota_units'],
                ['Carton Quota Units', 'carton_quota_units'],
                ['Pallet Quota Units', 'pallet_quota_units'],
                ['Seat Limit', 'seat_limit'],
                ['Plant Limit', 'plant_limit'],
                ['Handset Limit', 'handset_limit'],
              ].map(([label, key]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form[key as keyof PlanPayload]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={submitForm} disabled={saving}>
                <Upload className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : creatingTemplate ? 'Create Plan' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.template.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {plan.template.name}
                <Badge variant={plan.template.is_active ? 'default' : 'secondary'}>
                  {plan.template.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <p><span className="text-gray-500">Billing:</span> {plan.template.billing_cycle}</p>
                <p><span className="text-gray-500">Price:</span> {formatINRFromPaise(plan.template.plan_price)}</p>
                <p><span className="text-gray-500">Provider Plan:</span> {plan.template.razorpay_plan_id || '-'}</p>
                <p><span className="text-gray-500">Unit Size:</span> {plan.template.pricing_unit_size.toLocaleString()}</p>
              </div>

              {plan.template.description ? <p className="text-gray-600">{plan.template.description}</p> : null}

              {plan.active_version ? (
                <div className="rounded-md border p-3">
                  <p className="mb-2 font-medium text-slate-900">Current Live Quotas</p>
                  <div className="grid grid-cols-2 gap-2">
                    <p>Unit: {plan.active_version.unit_limit.toLocaleString()}</p>
                    <p>Box: {plan.active_version.box_limit.toLocaleString()}</p>
                    <p>Carton: {plan.active_version.carton_limit.toLocaleString()}</p>
                    <p>Pallet: {plan.active_version.pallet_limit.toLocaleString()}</p>
                    <p>Seats: {plan.active_version.seat_limit}</p>
                    <p>Plants: {plan.active_version.plant_limit}</p>
                    <p>Handsets: {plan.active_version.handset_limit}</p>
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => openEditPlan(plan)} disabled={saving}>
                  Edit Plan
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Plus, Upload } from 'lucide-react';

type PlanVersion = {
  id: string;
  version_number: number;
  unit_limit: number;
  box_limit: number;
  carton_limit: number;
  pallet_limit: number;
  seat_limit: number;
  plant_limit: number;
  handset_limit: number;
  grace_unit: number;
  grace_box: number;
  grace_carton: number;
  grace_pallet: number;
  is_active: boolean;
  change_note: string | null;
  created_at: string;
};

type PlanTemplate = {
  id: string;
  name: string;
  razorpay_plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  amount_from_razorpay: number;
  is_active: boolean;
  updated_at: string;
};

type PlanView = {
  template: PlanTemplate;
  active_version: PlanVersion | null;
  versions_count: number;
  versions: PlanVersion[];
};

type PlanPayload = {
  name: string;
  razorpay_plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  amount_from_razorpay: string;
  change_note: string;
  unit_limit: string;
  box_limit: string;
  carton_limit: string;
  pallet_limit: string;
  seat_limit: string;
  plant_limit: string;
  handset_limit: string;
  grace_unit: string;
  grace_box: string;
  grace_carton: string;
  grace_pallet: string;
};

const DEFAULT_PAYLOAD: PlanPayload = {
  name: '',
  razorpay_plan_id: '',
  billing_cycle: 'monthly',
  amount_from_razorpay: '0',
  change_note: '',
  unit_limit: '0',
  box_limit: '0',
  carton_limit: '0',
  pallet_limit: '0',
  seat_limit: '0',
  plant_limit: '0',
  handset_limit: '0',
  grace_unit: '0',
  grace_box: '0',
  grace_carton: '0',
  grace_pallet: '0',
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

function formatINRFromPaise(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((value || 0) / 100);
}

function buildVersionBody(form: PlanPayload) {
  return {
    unit_limit: parseNonNegativeInt(form.unit_limit),
    box_limit: parseNonNegativeInt(form.box_limit),
    carton_limit: parseNonNegativeInt(form.carton_limit),
    pallet_limit: parseNonNegativeInt(form.pallet_limit),
    seat_limit: parseNonNegativeInt(form.seat_limit),
    plant_limit: parseNonNegativeInt(form.plant_limit),
    handset_limit: parseNonNegativeInt(form.handset_limit),
    grace_unit: parseNonNegativeInt(form.grace_unit),
    grace_box: parseNonNegativeInt(form.grace_box),
    grace_carton: parseNonNegativeInt(form.grace_carton),
    grace_pallet: parseNonNegativeInt(form.grace_pallet),
    change_note: form.change_note.trim() || null,
  };
}

function mapVersionToPayload(version: PlanVersion): PlanPayload {
  return {
    ...DEFAULT_PAYLOAD,
    change_note: version.change_note || '',
    unit_limit: String(version.unit_limit ?? 0),
    box_limit: String(version.box_limit ?? 0),
    carton_limit: String(version.carton_limit ?? 0),
    pallet_limit: String(version.pallet_limit ?? 0),
    seat_limit: String(version.seat_limit ?? 0),
    plant_limit: String(version.plant_limit ?? 0),
    handset_limit: String(version.handset_limit ?? 0),
    grace_unit: String(version.grace_unit ?? 0),
    grace_box: String(version.grace_box ?? 0),
    grace_carton: String(version.grace_carton ?? 0),
    grace_pallet: String(version.grace_pallet ?? 0),
  };
}

export default function SubscriptionPlansPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [targetTemplateId, setTargetTemplateId] = useState<string | null>(null);
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
      setPlans(Array.isArray(data.plans) ? data.plans : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch plans');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  const targetPlan = useMemo(
    () => plans.find((plan) => plan.template.id === targetTemplateId) || null,
    [plans, targetTemplateId]
  );

  function openCreateTemplate() {
    setCreatingTemplate(true);
    setTargetTemplateId(null);
    setForm(DEFAULT_PAYLOAD);
    setMessage(null);
    setError(null);
  }

  function openCreateVersion(plan: PlanView) {
    setCreatingTemplate(false);
    setTargetTemplateId(plan.template.id);
    setForm({
      ...mapVersionToPayload(plan.active_version || (plan.versions[0] as PlanVersion)),
      name: plan.template.name,
      razorpay_plan_id: plan.template.razorpay_plan_id,
      billing_cycle: plan.template.billing_cycle,
      amount_from_razorpay: String(plan.template.amount_from_razorpay ?? 0),
    });
    setMessage(null);
    setError(null);
  }

  function closeForm() {
    setCreatingTemplate(false);
    setTargetTemplateId(null);
    setForm(DEFAULT_PAYLOAD);
  }

  async function submitForm() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const version = buildVersionBody(form);
      const isNewTemplate = creatingTemplate;
      const body = isNewTemplate
        ? {
            name: form.name.trim(),
            razorpay_plan_id: form.razorpay_plan_id.trim(),
            billing_cycle: form.billing_cycle,
            amount_from_razorpay: parseNonNegativeInt(form.amount_from_razorpay),
            version,
            publish: true,
          }
        : {
            template_id: targetTemplateId,
            version,
            publish: true,
          };

      if (isNewTemplate) {
        if (!body.name || !body.razorpay_plan_id) {
          throw new Error('Plan name and Razorpay Plan ID are required');
        }
      }

      const res = await fetch('/api/admin/subscription-plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to save plan');
      }
      setMessage(isNewTemplate ? 'Plan template created and published' : 'New plan version created and published');
      closeForm();
      await fetchPlans();
    } catch (err: any) {
      setError(err?.message || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  }

  async function publishVersion(plan: PlanView, version: PlanVersion) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/subscription-plans', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          template_id: plan.template.id,
          activate_version_id: version.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to publish version');
      }
      setMessage(`Published version v${version.version_number} for ${plan.template.name}`);
      await fetchPlans();
    } catch (err: any) {
      setError(err?.message || 'Failed to publish version');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#0052CC]">Subscription Plans</h1>
          <p className="text-sm text-gray-600 mt-1">DB-backed template + version management with publish controls.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchPlans} disabled={loading || saving} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={openCreateTemplate} disabled={saving}>
            <Plus className="w-4 h-4 mr-2" />
            New Plan Template
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {(creatingTemplate || targetTemplateId) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {creatingTemplate ? 'Create Template + Publish v1' : `Create New Version (${targetPlan?.template.name || ''})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {creatingTemplate && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Razorpay Plan ID *</Label>
                  <Input
                    placeholder="plan_xxx"
                    value={form.razorpay_plan_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, razorpay_plan_id: e.target.value }))}
                  />
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
                  <Label>Amount from Razorpay (paise)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.amount_from_razorpay}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount_from_razorpay: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ['Unit Limit', 'unit_limit'],
                ['Box Limit', 'box_limit'],
                ['Carton Limit', 'carton_limit'],
                ['Pallet Limit', 'pallet_limit'],
                ['Seat Limit', 'seat_limit'],
                ['Plant Limit', 'plant_limit'],
                ['Handset Limit', 'handset_limit'],
                ['Grace Unit', 'grace_unit'],
                ['Grace Box', 'grace_box'],
                ['Grace Carton', 'grace_carton'],
                ['Grace Pallet', 'grace_pallet'],
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

            <div className="space-y-2">
              <Label>Change Note</Label>
              <Input
                value={form.change_note}
                onChange={(e) => setForm((prev) => ({ ...prev, change_note: e.target.value }))}
                placeholder="Optional note for audit trail"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={submitForm} disabled={saving}>
                <Upload className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save & Publish'}
              </Button>
              <Button variant="outline" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <Card key={plan.template.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {plan.template.name}
                <Badge variant={plan.template.is_active ? 'default' : 'secondary'}>
                  {plan.template.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant="outline">
                  Published v{plan.active_version?.version_number ?? '-'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <p><span className="text-gray-500">Razorpay Plan ID:</span> <span className="font-mono">{plan.template.razorpay_plan_id}</span></p>
                <p><span className="text-gray-500">Billing:</span> {plan.template.billing_cycle}</p>
                <p><span className="text-gray-500">Amount:</span> {formatINRFromPaise(plan.template.amount_from_razorpay)}</p>
                <p><span className="text-gray-500">Versions:</span> {plan.versions_count}</p>
              </div>

              {plan.active_version ? (
                <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                  <p>Unit: {plan.active_version.unit_limit}</p>
                  <p>Box: {plan.active_version.box_limit}</p>
                  <p>Carton: {plan.active_version.carton_limit}</p>
                  <p>Pallet: {plan.active_version.pallet_limit}</p>
                  <p>Seat: {plan.active_version.seat_limit}</p>
                  <p>Plant: {plan.active_version.plant_limit}</p>
                  <p>Handset: {plan.active_version.handset_limit}</p>
                </div>
              ) : (
                <p className="text-gray-500">No active version</p>
              )}

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openCreateVersion(plan)} disabled={saving}>
                  Create New Version
                </Button>
              </div>

              <div className="space-y-1">
                {plan.versions.slice(0, 5).map((version) => (
                  <div key={version.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                    <span>
                      v{version.version_number} {version.change_note ? `• ${version.change_note}` : ''}
                    </span>
                    {version.is_active ? (
                      <Badge variant="outline">Published</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => publishVersion(plan, version)} disabled={saving}>
                        Publish
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Company = {
  id: string;
  company_name: string;
  subscription_status: string | null;
  subscription_plan: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  extra_user_seats: number | null;
  is_frozen: boolean | null;
  freeze_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [unitBonus, setUnitBonus] = useState<number>(0);
  const [boxBonus, setBoxBonus] = useState<number>(0);
  const [cartonBonus, setCartonBonus] = useState<number>(0);
  const [palletBonus, setPalletBonus] = useState<number>(0);
  const [bonusReason, setBonusReason] = useState('');
  const [bonusLoading, setBonusLoading] = useState(false);

  function createIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function fetchCompany() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to load company');
      }
      setCompany(data.company as Company);
    } catch (err: any) {
      setError(err?.message || 'Failed to load company');
    } finally {
      setLoading(false);
    }
  }

  async function handleBonusSubmit() {
    if (unitBonus <= 0 && boxBonus <= 0 && cartonBonus <= 0 && palletBonus <= 0) {
      alert('Enter bonus amount');
      return;
    }

    setBonusLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/bonus-quota`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          unit_bonus: unitBonus,
          box_bonus: boxBonus,
          carton_bonus: cartonBonus,
          pallet_bonus: palletBonus,
          reason: bonusReason,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to grant bonus');
      }

      alert('Bonus granted successfully');
      setUnitBonus(0);
      setBoxBonus(0);
      setCartonBonus(0);
      setPalletBonus(0);
      setBonusReason('');
      fetchCompany();
    } catch (err: any) {
      alert(err?.message || 'Failed to grant bonus');
    } finally {
      setBonusLoading(false);
    }
  }

  useEffect(() => {
    if (companyId) fetchCompany();
  }, [companyId]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="space-y-4">
        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => router.push('/admin/companies')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <Button onClick={fetchCompany} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-bold">
            {company?.company_name || 'Company'}
          </h1>
          <p className="text-sm text-gray-500">Company details</p>
        </div>
      </div>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Company ID</span>
            <span className="font-mono">{company?.id || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Subscription Status</span>
            <span>{company?.subscription_status || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Plan</span>
            <span>{company?.subscription_plan || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Extra Seats</span>
            <span>{company?.extra_user_seats ?? 0}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Frozen</span>
            {company?.is_frozen ? (
              <Badge variant="destructive">Yes</Badge>
            ) : (
              <Badge variant="secondary">No</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bonus Quota Card */}
      <Card>
        <CardHeader>
          <CardTitle>Grant Bonus Quota</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-gray-500">
            Provide a value for each quota type below (Unit, Box, Carton, Pallet). Leave unused types at zero.
          </p>

          <div className="space-y-3">
            {[
              { label: 'Unit (code: UNIT)', value: unitBonus, setter: setUnitBonus },
              { label: 'Box (code: BOX)', value: boxBonus, setter: setBoxBonus },
              { label: 'Carton (code: CARTON)', value: cartonBonus, setter: setCartonBonus },
              { label: 'Pallet (code: PALLET)', value: palletBonus, setter: setPalletBonus },
            ].map((item) => (
              <div key={item.label} className="grid grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)] items-center">
                <span className="text-xs font-semibold text-gray-600">{item.label}</span>
                <Input
                  type="number"
                  placeholder="Enter value"
                  value={item.value}
                  min={0}
                  onChange={(e) => item.setter(Number(e.target.value))}
                />
              </div>
            ))}
          </div>

          <Textarea
            placeholder="Reason (required)"
            value={bonusReason}
            onChange={(e) => setBonusReason(e.target.value)}
          />

          <Button
            onClick={handleBonusSubmit}
            disabled={bonusLoading}
            className="w-full"
          >
            {bonusLoading ? 'Granting...' : 'Grant Bonus'}
          </Button>

        </CardContent>
      </Card>

    </div>
  );
}

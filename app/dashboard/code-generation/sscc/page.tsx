'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { saveAs } from 'file-saver';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, Download, FileText, Info, Printer, Package } from 'lucide-react';
import QRCodeComponent from '@/components/custom/QRCodeComponent';
import DataMatrixComponent from '@/components/custom/DataMatrixComponent';
import { supabaseClient } from '@/lib/supabase/client';
import { exportLabels as exportLabelsUtil, LabelData } from '@/lib/labelExporter';
import { useSubscriptionSummary } from '@/lib/hooks/useSubscriptionSummary';
import { LABEL_CODE_TYPE_OPTIONS, normalizeLabelCodeType, type LabelCodeType } from '@/lib/labelCodeType';

type GenerationLevel = 'BOX' | 'CARTON' | 'PALLET';

type UnitSkuMaster = {
  id: string;
  sku_code: string;
  gtin: string | null;
  batch: string;
  expiry: string;
  mfd: string | null;
  mrp: string | null;
  created_at: string;
};

type SSCCLabel = {
  id: string;
  sscc: string;
  ssccWithAi: string;
  level: GenerationLevel;
  skuCode: string;
  codeType: LabelCodeType;
};

type SSCCFormState = {
  unitSkuMasterId: string;
  unitsPerBox: number;
  boxesPerCarton: number;
  cartonsPerPallet: number;
  numberOfPallets: number;
  codeType: LabelCodeType;
  generateBox: boolean;
  generateCarton: boolean;
  generatePallet: boolean;
  complianceAck: boolean;
};

const MAX_CODES_PER_REQUEST = 1000;
const MAX_CODES_PER_ROW = 1000;

function getApiErrorMessage(payload: any, fallback: string) {
  if (payload?.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return fallback;
}

function estimateSsccCodes(params: {
  numberOfPallets: number;
  generateBox: boolean;
  generateCarton: boolean;
  generatePallet: boolean;
  boxesPerCarton: number;
  cartonsPerPallet: number;
}): number {
  const pallets = Math.max(0, Number(params.numberOfPallets) || 0);
  const boxesPerCarton = Math.max(1, Number(params.boxesPerCarton) || 1);
  const cartonsPerPallet = Math.max(1, Number(params.cartonsPerPallet) || 1);

  let total = 0;
  if (params.generateBox) total += pallets * boxesPerCarton * cartonsPerPallet;
  if (params.generateCarton) total += pallets * cartonsPerPallet;
  if (params.generatePallet) total += pallets;
  return total;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toLabelData(items: SSCCLabel[]): LabelData[] {
  return items.map((item) => ({
    id: item.id,
    payload: item.ssccWithAi,
    codeType: item.codeType,
    displayText: `${item.skuCode} | ${item.level} | SSCC: ${item.sscc}`,
    metadata: {
      skuCode: item.skuCode,
      level: item.level,
      sscc: item.sscc,
    },
  }));
}

function exportGeneratedSsccCsv(labels: SSCCLabel[]) {
  const csvCell = (value: unknown, options?: { preserveText?: boolean }) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    const escaped = normalized.replace(/"/g, '""');
    if (options?.preserveText) {
      return `="${escaped}"`;
    }
    return `"${escaped}"`;
  };

  const rows = [
    ['SKU Code', 'Level', 'SSCC', 'SSCC with AI', 'Code Type'],
    ...labels.map((label) => [
      label.skuCode,
      label.level,
      label.sscc,
      label.ssccWithAi,
      label.codeType,
    ]),
  ];

  const csv = rows
    .map((row, rowIndex) =>
      row
        .map((value, colIndex) =>
          csvCell(value, {
            preserveText: rowIndex > 0 && (colIndex === 2 || colIndex === 3),
          })
        )
        .join(',')
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `sscc_generated_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`);
}

export default function SSCCCodeGenerationPage() {
  const { data: entitlementSummary, loading: subscriptionLoading } = useSubscriptionSummary();
  const subscriptionState = entitlementSummary?.subscriptionStatus?.status ?? null;
  const hasActiveSubscription =
    entitlementSummary?.subscriptionStatus?.status === 'active' ||
    entitlementSummary?.subscription?.status === 'active';
  const trialActive = Boolean(entitlementSummary?.entitlement?.trial_active);
  const subscriptionCancelled = subscriptionState === 'cancelled';
  const canGenerate = !subscriptionCancelled && (hasActiveSubscription || trialActive);
  const generationBlockMessage = subscriptionCancelled
    ? 'Subscription is cancelled. Renew your plan to continue code generation.'
    : 'Generation is disabled. Trial expired or no active subscription.';

  const [form, setForm] = useState<SSCCFormState>({
    unitSkuMasterId: '',
    unitsPerBox: 10,
    boxesPerCarton: 12,
    cartonsPerPallet: 20,
    numberOfPallets: 1,
    codeType: 'DATAMATRIX',
    generateBox: false,
    generateCarton: false,
    generatePallet: false,
    complianceAck: false,
  });

  const [labels, setLabels] = useState<SSCCLabel[]>([]);
  const [skuMasters, setSkuMasters] = useState<UnitSkuMaster[]>([]);
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabaseClient().auth.getUser();
        if (!user) return;

        const { data: company } = await supabaseClient()
          .from('companies')
          .select('profile_completed')
          .eq('user_id', user.id)
          .single();

        if (company?.profile_completed !== undefined) {
          setProfileCompleted(company.profile_completed);
        }

        const res = await fetch('/api/skus?scope=unit_master&gtin_only=true', { cache: 'no-store' });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(getApiErrorMessage(out, 'Failed to load SKU Master'));
        }

        const nextItems = Array.isArray(out?.items) ? (out.items as UnitSkuMaster[]) : [];
        const gtinEligible = nextItems.filter((item) => typeof item.gtin === 'string' && item.gtin.trim().length > 0);
        setSkuMasters(gtinEligible);
        if (gtinEligible.length > 0) {
          setForm((prev) => ({ ...prev, unitSkuMasterId: prev.unitSkuMasterId || gtinEligible[0].id }));
        }
      } catch (err: any) {
        console.error('[sscc/page] bootstrap_failed', err);
        setError(err?.message || 'Unable to load SKU Master right now. Please refresh and try again.');
      } finally {
        setLoadingMaster(false);
      }
    })();
  }, []);

  const selectedSkuMaster = useMemo(
    () => skuMasters.find((item) => item.id === form.unitSkuMasterId) || null,
    [skuMasters, form.unitSkuMasterId]
  );

  const singleRequestedCodes = estimateSsccCodes({
    numberOfPallets: form.numberOfPallets,
    generateBox: form.generateBox,
    generateCarton: form.generateCarton,
    generatePallet: form.generatePallet,
    boxesPerCarton: form.boxesPerCarton,
    cartonsPerPallet: form.cartonsPerPallet,
  });

  const singleLimitError = singleRequestedCodes > MAX_CODES_PER_ROW
    ? `Per entry limit is ${MAX_CODES_PER_ROW.toLocaleString()} codes (current estimate: ${singleRequestedCodes.toLocaleString()}).`
    : singleRequestedCodes > MAX_CODES_PER_REQUEST
      ? `Per request limit is ${MAX_CODES_PER_REQUEST.toLocaleString()} codes (current estimate: ${singleRequestedCodes.toLocaleString()}).`
      : null;

  function update<K extends keyof SSCCFormState>(key: K, value: SSCCFormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };

      if (key === 'generateBox' && !value) {
        next.generateCarton = false;
        next.generatePallet = false;
      } else if (key === 'generateCarton') {
        if (value) {
          next.generateBox = true;
        } else {
          next.generatePallet = false;
        }
      } else if (key === 'generatePallet' && value) {
        next.generateBox = true;
        next.generateCarton = true;
      }

      return next;
    });
  }

  async function handleGenerate() {
    setError(null);
    setSuccess(null);

    if (!canGenerate) {
      setError(generationBlockMessage);
      return;
    }
    if (!selectedSkuMaster) {
      setError('Select a GTIN-enabled SKU Master record first.');
      return;
    }
    if (!form.complianceAck) {
      setError('You must confirm compliance to generate SSCC codes.');
      return;
    }
    if (!form.generateBox && !form.generateCarton && !form.generatePallet) {
      setError('Please select at least one SSCC level (Box, Carton, or Pallet).');
      return;
    }
    if (form.generateCarton && !form.generateBox) {
      setError('Carton generation requires Box generation in the same request.');
      return;
    }
    if (form.generatePallet && (!form.generateBox || !form.generateCarton)) {
      setError('Pallet generation requires Box and Carton generation in the same request.');
      return;
    }
    if (singleLimitError) {
      setError(singleLimitError);
      return;
    }

    try {
      setLoading(true);
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${selectedSkuMaster.id}-${singleRequestedCodes}`;
      const res = await fetch('/api/sscc/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          unit_sku_master_id: selectedSkuMaster.id,
          units_per_box: form.unitsPerBox,
          boxes_per_carton: form.boxesPerCarton,
          cartons_per_pallet: form.cartonsPerPallet,
          number_of_pallets: form.numberOfPallets,
          generate_box: form.generateBox,
          generate_carton: form.generateCarton,
          generate_pallet: form.generatePallet,
          code_type: form.codeType,
          compliance_ack: true,
        }),
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(getApiErrorMessage(out, 'Unable to generate SSCC codes right now. Please retry.'));
      }

      const data = out?.data ?? out;
      const allItems: Array<any> = [
        ...((Array.isArray(data?.boxes) ? data.boxes : []).map((item: any) => ({ ...item, level: 'BOX' as GenerationLevel }))),
        ...((Array.isArray(data?.cartons) ? data.cartons : []).map((item: any) => ({ ...item, level: 'CARTON' as GenerationLevel }))),
        ...((Array.isArray(data?.pallets) ? data.pallets : []).map((item: any) => ({ ...item, level: 'PALLET' as GenerationLevel }))),
      ];

      const nextLabels: SSCCLabel[] = allItems.map((item, index) => ({
        id: String(item?.id ?? `${selectedSkuMaster.id}-${Date.now()}-${index}`),
        sscc: String(item?.sscc ?? ''),
        ssccWithAi: String(item?.sscc_with_ai ?? `(00)${String(item?.sscc ?? '')}`),
        level: item.level,
        skuCode: selectedSkuMaster.sku_code,
        codeType: normalizeLabelCodeType(form.codeType),
      }));

      setLabels((prev) => [...prev, ...nextLabels]);
      const levelBreakdown = [
        form.generateBox ? `${Array.isArray(data?.boxes) ? data.boxes.length : 0} Box` : null,
        form.generateCarton ? `${Array.isArray(data?.cartons) ? data.cartons.length : 0} Carton` : null,
        form.generatePallet ? `${Array.isArray(data?.pallets) ? data.pallets.length : 0} Pallet` : null,
      ].filter(Boolean).join(', ');
      setSuccess(`Generated ${nextLabels.length} SSCC code(s) successfully${out?.data?.batch_no ? ` in batch ${out.data.batch_no}` : ''}${levelBreakdown ? ` (${levelBreakdown})` : ''}.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to generate SSCC codes right now. Please retry.');
    } finally {
      setLoading(false);
    }
  }

  async function handleExport(format: 'PDF' | 'PNG' | 'ZPL' | 'EPL' | 'ZIP' | 'PRINT') {
    if (labels.length === 0) {
      setError('No SSCC labels to export.');
      return;
    }

    try {
      await exportLabelsUtil(
        toLabelData(labels),
        format,
        `sscc_labels_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.${format.toLowerCase()}`
      );
    } catch (err: any) {
      setError(err?.message || `Failed to export ${format}.`);
    }
  }

  if (profileCompleted === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">SSCC / Logistics Code Generation</h1>
          <p className="text-sm text-gray-600">Generate logistics codes using hierarchy: Unit → Box → Carton → Pallet (SSCC).</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Company Setup Required:</strong> Please complete your company setup before generating codes.
            <Button asChild variant="link" className="p-0 ml-2 h-auto">
              <Link href="/onboarding/company-setup">Go to Company Setup</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">SSCC / Logistics Code Generation</h1>
        <p className="text-sm text-gray-600">Select a GTIN-enabled SKU Master record, choose hierarchy and code type, then generate SSCC codes.</p>
      </div>

      {!subscriptionLoading && !canGenerate && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {generationBlockMessage}
            <Button asChild variant="link" className="p-0 ml-2 h-auto">
              <Link href="/dashboard/subscription">View Plans</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          SSCC now uses SKU Master for SKU selection only. Batch, expiry, and CSV generation are no longer part of the SSCC page. Only SKU Master records with a GTIN can be used here.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Generate SSCC Codes</CardTitle>
              <CardDescription>SKU Master provides the GTIN-qualified SKU reference. Hierarchy and code type remain request-time choices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="sscc-sku-master">SKU Master *</Label>
                  <Select
                    value={form.unitSkuMasterId}
                    onValueChange={(value) => update('unitSkuMasterId', value)}
                    disabled={loadingMaster || skuMasters.length === 0}
                  >
                    <SelectTrigger id="sscc-sku-master">
                      <SelectValue placeholder={loadingMaster ? 'Loading SKU Master...' : 'Select GTIN-enabled SKU Master'} />
                    </SelectTrigger>
                    <SelectContent>
                      {skuMasters.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.sku_code} | {item.gtin}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="sscc-code-type">Code Type *</Label>
                  <Select value={form.codeType} onValueChange={(value) => update('codeType', normalizeLabelCodeType(value))}>
                    <SelectTrigger id="sscc-code-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LABEL_CODE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedSkuMaster ? (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Selected SKU Master Values</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><span className="text-gray-500">SKU Code:</span> <span className="font-medium text-gray-900">{selectedSkuMaster.sku_code}</span></div>
                    <div><span className="text-gray-500">GTIN:</span> <span className="font-mono text-gray-900">{selectedSkuMaster.gtin}</span></div>
                    <div><span className="text-gray-500">Batch Snapshot:</span> <span className="font-medium text-gray-900">{selectedSkuMaster.batch}</span></div>
                    <div><span className="text-gray-500">Expiry Snapshot:</span> <span className="font-medium text-gray-900">{formatDate(selectedSkuMaster.expiry)}</span></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    Batch and expiry remain in SKU Master for traceability context, but SSCC generation no longer collects them as request-time inputs.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  No GTIN-enabled SKU Master records are available yet.
                  <Button asChild variant="link" className="p-0 ml-2 h-auto">
                    <Link href="/dashboard/sku">Create GTIN-enabled SKU Master</Link>
                  </Button>
                </div>
              )}

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">SSCC Level Selection *</h4>
                <p className="text-xs text-gray-600 mb-3">
                  Higher logistic levels automatically include lower levels. SSCC generation follows Box → Carton → Pallet hierarchy.
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generateBox}
                      onChange={(e) => update('generateBox', e.target.checked)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 font-medium">Box</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generateCarton}
                      onChange={(e) => update('generateCarton', e.target.checked)}
                      disabled={!form.generateBox}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-gray-700 font-medium">
                      Carton {!form.generateBox && <span className="text-gray-400">(requires Box)</span>}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generatePallet}
                      onChange={(e) => update('generatePallet', e.target.checked)}
                      disabled={!form.generateBox || !form.generateCarton}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-gray-700 font-medium">
                      Pallet {(!form.generateBox || !form.generateCarton) && <span className="text-gray-400">(requires Box + Carton)</span>}
                    </span>
                  </label>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Hierarchy Configuration</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="unitsPerBox">Units per Box *</Label>
                    <Input
                      id="unitsPerBox"
                      type="number"
                      min="1"
                      value={form.unitsPerBox}
                      onChange={(e) => update('unitsPerBox', parseInt(e.target.value, 10) || 1)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="boxesPerCarton">Boxes per Carton *</Label>
                    <Input
                      id="boxesPerCarton"
                      type="number"
                      min="1"
                      value={form.boxesPerCarton}
                      onChange={(e) => update('boxesPerCarton', parseInt(e.target.value, 10) || 1)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cartonsPerPallet">Cartons per Pallet *</Label>
                    <Input
                      id="cartonsPerPallet"
                      type="number"
                      min="1"
                      value={form.cartonsPerPallet}
                      onChange={(e) => update('cartonsPerPallet', parseInt(e.target.value, 10) || 1)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="numberOfPallets">Number of Pallets *</Label>
                    <Input
                      id="numberOfPallets"
                      type="number"
                      min="1"
                      max={MAX_CODES_PER_ROW}
                      value={form.numberOfPallets}
                      onChange={(e) => update('numberOfPallets', parseInt(e.target.value, 10) || 1)}
                    />
                    <p className={`text-xs mt-1 ${singleLimitError ? 'text-red-600' : 'text-gray-600'}`}>
                      Estimated codes: {singleRequestedCodes.toLocaleString()}. Limits: {MAX_CODES_PER_ROW.toLocaleString()} per entry, {MAX_CODES_PER_REQUEST.toLocaleString()} per request.
                    </p>
                  </div>
                </div>
              </div>

              <Alert className="bg-slate-50 border-slate-200">
                <AlertDescription className="text-slate-800">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.complianceAck}
                      onChange={(e) => update('complianceAck', e.target.checked)}
                      className="mt-1"
                    />
                    <span>I confirm I understand and accept the compliance responsibility for generated SSCC codes.</span>
                  </label>
                </AlertDescription>
              </Alert>

              <Button
                type="button"
                onClick={handleGenerate}
                disabled={loading || !canGenerate || !selectedSkuMaster || !form.complianceAck || !!singleLimitError}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {loading ? 'Generating...' : 'Generate SSCC Codes'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Hierarchy Structure</CardTitle>
              <CardDescription>Unit → Box → Carton → Pallet (SSCC)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="font-semibold text-gray-900 mb-1">Unit</div>
                  <div className="text-gray-600">Saleable pack (generated separately)</div>
                </div>
                <div className="text-center text-gray-400">↓</div>
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="font-semibold text-blue-900 mb-1">Box</div>
                  <div className="text-blue-700">{form.unitsPerBox} units per box</div>
                </div>
                <div className="text-center text-gray-400">↓</div>
                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                  <div className="font-semibold text-green-900 mb-1">Carton</div>
                  <div className="text-green-700">{form.boxesPerCarton} boxes per carton</div>
                </div>
                <div className="text-center text-gray-400">↓</div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="font-semibold text-amber-900 mb-1">Pallet (SSCC)</div>
                  <div className="text-amber-700">{form.cartonsPerPallet} cartons per pallet</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Generated SSCC Codes</CardTitle>
              <CardDescription>{labels.length} SSCC code(s) generated in this session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {labels.length === 0 ? (
                <div className="text-sm text-gray-600">Generated SSCC codes will appear here after creation.</div>
              ) : (
                <>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {labels.slice(0, 6).map((label) => (
                      <div key={label.id} className="p-3 border border-gray-200 rounded-lg bg-white">
                        <div className="text-xs font-mono text-gray-600 mb-2 break-all">{label.ssccWithAi}</div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-24 bg-white border border-gray-100 flex items-center justify-center">
                            {label.codeType === 'QR' ? (
                              <QRCodeComponent value={label.ssccWithAi} size={84} />
                            ) : (
                              <DataMatrixComponent value={label.ssccWithAi} size={84} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{label.skuCode}</div>
                            <div className="text-xs text-gray-600">Level: {label.level}</div>
                            <div className="text-xs text-gray-600">Type: {label.codeType === 'QR' ? 'QR Code' : 'DataMatrix'}</div>
                            <div className="text-xs text-gray-600 font-mono">SSCC: {label.sscc}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {labels.length > 6 && (
                    <div className="text-xs text-gray-500">+ {labels.length - 6} more SSCC code(s)</div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Export</CardTitle>
              <CardDescription>Export or print the generated SSCC labels from this session.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="border-gray-300" disabled={labels.length === 0} onClick={() => exportGeneratedSsccCsv(labels)}>
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={labels.length === 0} onClick={() => void handleExport('PNG')}>
                <Package className="w-4 h-4 mr-2" />
                PNG
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={labels.length === 0} onClick={() => void handleExport('PDF')}>
                PDF
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={labels.length === 0} onClick={() => void handleExport('ZPL')}>
                ZPL
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={labels.length === 0} onClick={() => void handleExport('EPL')}>
                EPL
              </Button>
              <Button type="button" variant="outline" className="border-gray-300 col-span-2" disabled={labels.length === 0} onClick={() => void handleExport('PRINT')}>
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

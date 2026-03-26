'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, Download, Package, Printer } from 'lucide-react';
import QRCodeComponent from '@/components/custom/QRCodeComponent';
import DataMatrixComponent from '@/components/custom/DataMatrixComponent';
import { useSubscriptionSummary } from '@/lib/hooks/useSubscriptionSummary';
import { exportLabels as exportLabelsUtil, LabelData } from '@/lib/labelExporter';
import { LABEL_CODE_TYPE_OPTIONS, normalizeLabelCodeType, type LabelCodeType } from '@/lib/labelCodeType';

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

type GeneratedUnit = {
  id: string;
  serial: string;
  payload: string;
  codeMode: 'GS1' | 'PIC';
  codeType: LabelCodeType;
  skuCode: string;
  gtin: string | null;
  batch: string;
  expiry: string;
};

const MAX_CODES_PER_REQUEST = 10000;
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

function toLabelData(items: GeneratedUnit[]): LabelData[] {
  return items.map((item) => ({
    id: item.id,
    payload: item.payload,
    codeType: item.codeType,
    displayText: `${item.skuCode} | Batch: ${item.batch} | Serial: ${item.serial}`,
    metadata: {
      skuCode: item.skuCode,
      gtin: item.gtin,
      batch: item.batch,
      expiry: item.expiry,
    },
  }));
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function UnitCodeGenerationPage() {
  const { data: entitlementSummary } = useSubscriptionSummary();
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

  const [items, setItems] = useState<UnitSkuMaster[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [codeType, setCodeType] = useState<LabelCodeType>('DATAMATRIX');
  const [complianceAck, setComplianceAck] = useState(false);
  const [generated, setGenerated] = useState<GeneratedUnit[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingMaster(true);
      try {
        const res = await fetch('/api/skus?scope=unit_master', { cache: 'no-store' });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(getApiErrorMessage(out, 'Failed to load SKU Master'));
        }
        const nextItems = Array.isArray(out?.items) ? (out.items as UnitSkuMaster[]) : [];
        setItems(nextItems);
        if (nextItems.length > 0) {
          setSelectedId((prev) => prev || nextItems[0].id);
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load SKU Master');
      } finally {
        setLoadingMaster(false);
      }
    })();
  }, []);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const singleLimitError =
    quantity > MAX_CODES_PER_ROW
      ? `Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`
      : quantity > MAX_CODES_PER_REQUEST
        ? `Per request limit exceeded. Maximum ${MAX_CODES_PER_REQUEST.toLocaleString()} codes per request.`
        : null;

  async function handleGenerate() {
    setError(null);
    setSuccess(null);

    if (!canGenerate) {
      setError(generationBlockMessage);
      return;
    }
    if (!selected) {
      setError('Select a SKU Master record first.');
      return;
    }
    if (!complianceAck) {
      setError('You must confirm compliance to generate codes.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('Quantity must be a positive integer.');
      return;
    }
    if (singleLimitError) {
      setError(singleLimitError);
      return;
    }

    try {
      setGenerating(true);
      const res = await fetch('/api/unit/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_sku_master_id: selected.id,
          quantity,
          compliance_ack: true,
        }),
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(getApiErrorMessage(out, 'Unable to generate unit codes right now. Please retry.'));
      }

      const responseItems = Array.isArray(out?.data?.items)
        ? out.data.items
        : Array.isArray(out?.items)
          ? out.items
          : null;

      if (!responseItems) {
        throw new Error('Unit code generation failed. Invalid response format.');
      }

      const nextItems: GeneratedUnit[] = responseItems.map((item: any, index: number) => {
        const codeMode = (item?.code_mode === 'PIC' ? 'PIC' : 'GS1') as 'GS1' | 'PIC';
        return {
          id: `${selected.id}-${Date.now()}-${index}`,
          serial: String(item?.serial ?? ''),
          payload: String(item?.payload ?? item?.gs1 ?? ''),
          codeMode,
          codeType,
          skuCode: selected.sku_code,
          gtin: selected.gtin,
          batch: selected.batch,
          expiry: selected.expiry,
        };
      });

      setGenerated((prev) => [...prev, ...nextItems]);
      setSuccess(
        `Generated ${nextItems.length} unit code(s) successfully using ${selected.gtin ? 'GS1' : 'PIC'} mode from SKU Master.`
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to generate unit codes right now. Please retry.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleExport(format: 'PDF' | 'PNG' | 'ZPL' | 'EPL' | 'ZIP' | 'PRINT') {
    if (generated.length === 0) return;
    try {
      await exportLabelsUtil(
        toLabelData(generated),
        format,
        `unit_labels_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.${format.toLowerCase()}`
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to export generated labels.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">Unit Code Generation</h1>
        <p className="text-sm text-gray-600">Select a SKU Master record, enter quantity, choose QR or DataMatrix, and generate unique serialized Unit codes.</p>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-blue-800">
          Fixed Unit payload fields now come from SKU Master. If any payload-related value changes, create a new SKU Master record instead of editing an old one.
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
              <CardTitle className="text-lg font-semibold">Generate Unit Codes</CardTitle>
              <CardDescription>SKU Master provides the fixed product fields. Quantity, code type, and compliance stay request-time only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="unit-sku-master">SKU Master *</Label>
                  <Select value={selectedId} onValueChange={setSelectedId} disabled={loadingMaster || items.length === 0}>
                    <SelectTrigger id="unit-sku-master">
                      <SelectValue placeholder={loadingMaster ? 'Loading SKU Master...' : 'Select SKU Master'} />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.sku_code} | {item.batch} | {item.expiry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    max={MAX_CODES_PER_ROW}
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                  />
                  <p className={`text-xs mt-1 ${singleLimitError ? 'text-red-600' : 'text-gray-500'}`}>
                    Limit: up to {MAX_CODES_PER_ROW.toLocaleString()} per request.
                  </p>
                </div>

                <div>
                  <Label htmlFor="unit-code-type">Code Type *</Label>
                  <Select value={codeType} onValueChange={(value) => setCodeType(normalizeLabelCodeType(value))}>
                    <SelectTrigger id="unit-code-type">
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

              {selected ? (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Selected SKU Master Values</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><span className="text-gray-500">SKU Code:</span> <span className="font-medium text-gray-900">{selected.sku_code}</span></div>
                    <div><span className="text-gray-500">Mode:</span> <span className="font-medium text-gray-900">{selected.gtin ? 'GS1' : 'PIC'}</span></div>
                    <div><span className="text-gray-500">GTIN:</span> <span className="font-mono text-gray-900">{selected.gtin || 'Not present'}</span></div>
                    <div><span className="text-gray-500">Batch:</span> <span className="font-medium text-gray-900">{selected.batch}</span></div>
                    <div><span className="text-gray-500">Expiry:</span> <span className="font-medium text-gray-900">{formatDate(selected.expiry)}</span></div>
                    <div><span className="text-gray-500">MFD:</span> <span className="font-medium text-gray-900">{formatDate(selected.mfd)}</span></div>
                    <div><span className="text-gray-500">MRP:</span> <span className="font-medium text-gray-900">{selected.mrp || 'N/A'}</span></div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  No SKU Master records available yet.
                  <Button asChild variant="link" className="p-0 ml-2 h-auto">
                    <Link href="/dashboard/sku">Create SKU Master</Link>
                  </Button>
                </div>
              )}

              <Alert className="bg-slate-50 border-slate-200">
                <AlertDescription className="text-slate-800">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={complianceAck}
                      onChange={(e) => setComplianceAck(e.target.checked)}
                      className="mt-1"
                    />
                    <span>I confirm I understand and accept the compliance responsibility for generated Unit codes.</span>
                  </label>
                </AlertDescription>
              </Alert>

              <Button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || generating || !selected || !complianceAck || !!singleLimitError}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {generating ? 'Generating...' : 'Generate Unit Codes'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Generated Output</CardTitle>
              <CardDescription>{generated.length} unit code(s) generated in this session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {generated.length === 0 ? (
                <div className="text-sm text-gray-600">Generated codes will appear here after creation.</div>
              ) : (
                <>
                  <div className="space-y-3">
                    {generated.slice(0, 5).map((item) => (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-24 bg-white border border-gray-100 flex items-center justify-center">
                            {item.codeType === 'QR' ? (
                              <QRCodeComponent value={item.payload} size={84} />
                            ) : (
                              <DataMatrixComponent value={item.payload} size={84} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{item.skuCode}</div>
                            <div className="text-xs text-gray-600">Mode: {item.codeMode}</div>
                            <div className="text-xs text-gray-600">Batch: {item.batch}</div>
                            <div className="text-xs text-gray-600 font-mono">Serial: {item.serial}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {generated.length > 5 && (
                    <div className="text-xs text-gray-500">+ {generated.length - 5} more generated code(s)</div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Export</CardTitle>
              <CardDescription>Export or print the generated labels from this session.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="border-gray-300" disabled={generated.length === 0} onClick={() => void handleExport('PDF')}>
                <Download className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={generated.length === 0} onClick={() => void handleExport('PNG')}>
                <Package className="w-4 h-4 mr-2" />
                PNG
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={generated.length === 0} onClick={() => void handleExport('ZPL')}>
                ZPL
              </Button>
              <Button type="button" variant="outline" className="border-gray-300" disabled={generated.length === 0} onClick={() => void handleExport('EPL')}>
                EPL
              </Button>
              <Button type="button" variant="outline" className="border-gray-300 col-span-2" disabled={generated.length === 0} onClick={() => void handleExport('PRINT')}>
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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, Trash2, Download, FileText, AlertCircle, CheckCircle, PackagePlus } from 'lucide-react';

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

type ImportResult = {
  total: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  errors: Array<{ row: number; error: string }>;
};

type FormState = {
  sku_code: string;
  gtin: string;
  batch: string;
  expiry: string;
  mfd: string;
  mrp: string;
};

const EMPTY_FORM: FormState = {
  sku_code: '',
  gtin: '',
  batch: '',
  expiry: '',
  mfd: '',
  mrp: '',
};

function downloadTextFile(filename: string, content: string, contentType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProductsPage() {
  const [items, setItems] = useState<UnitSkuMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [importSummary, setImportSummary] = useState<ImportResult | null>(null);

  const safeReadJson = useCallback(async (res: Response) => {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/skus?scope=unit_master', { cache: 'no-store' });
      const out = await safeReadJson(res);
      if (!res.ok) {
        throw new Error(out?.error || 'Failed to load SKU Master');
      }
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load SKU Master');
    } finally {
      setLoading(false);
    }
  }, [safeReadJson]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [
        item.sku_code,
        item.gtin || '',
        item.batch,
        item.expiry,
        item.mfd || '',
        item.mrp || '',
      ].some((value) => value.toLowerCase().includes(term))
    );
  }, [items, searchTerm]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function downloadTemplate() {
    const csv = Papa.unparse(
      [
        {
          sku_code: 'Ciplox 400 mg 10 tab strip',
          gtin: '01234567890128',
          batch: 'BATCH-APR-2026',
          expiry: '2027-04-30',
          mfd: '2026-04-01',
          mrp: '125.00',
        },
      ],
      { header: true }
    );
    downloadTextFile('unit_sku_master_template.csv', csv, 'text/csv;charset=utf-8');
  }

  async function handleCreate() {
    setSubmitting(true);
    setError('');
    setSuccess('');
    setImportSummary(null);
    try {
      const res = await fetch('/api/skus?scope=unit_master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const out = await safeReadJson(res);
      if (!res.ok) {
        throw new Error(out?.error || 'Failed to create SKU Master record');
      }
      setForm(EMPTY_FORM);
      setSuccess('SKU Master record created successfully.');
      await fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to create SKU Master record');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: UnitSkuMaster) {
    const confirmed = window.confirm(
      `Delete this SKU Master record?\n\nSKU: ${item.sku_code}\nBatch: ${item.batch}\nExpiry: ${item.expiry}\n\nThis will hide it from future Unit generation but keep historical generated records intact.`
    );
    if (!confirmed) return;

    setError('');
    setSuccess('');
    setImportSummary(null);

    try {
      const res = await fetch(`/api/skus/${item.id}?scope=unit_master`, { method: 'DELETE' });
      const out = await safeReadJson(res);
      if (!res.ok) {
        throw new Error(out?.error || 'Failed to delete SKU Master record');
      }
      setSuccess('SKU Master record deleted successfully.');
      await fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete SKU Master record');
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setError('');
    setSuccess('');
    setImportSummary(null);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      if (!parsed.data.length) {
        throw new Error('CSV file is empty.');
      }
      const res = await fetch('/api/skus/import?scope=unit_master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed.data }),
      });
      const out = await safeReadJson(res);
      if (!res.ok) {
        throw new Error(out?.error || 'Failed to import SKU Master CSV');
      }
      const results = out?.results as ImportResult;
      setImportSummary(results);
      setSuccess(`CSV processed. Inserted ${results?.inserted || 0} of ${results?.total || 0} row(s).`);
      await fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to import SKU Master CSV');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">SKU Master</h1>
          <p className="text-sm text-gray-600">
            SKU Master is the source of truth for fixed Unit code inputs and the SKU selector source for SSCC. Existing records cannot be edited. If any value changes, create a new record.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={downloadTemplate} className="border-gray-300">
          <Download className="w-4 h-4 mr-2" />
          Download Template
        </Button>
      </div>

      <Alert className="bg-slate-50 border-slate-200">
        <AlertDescription className="text-slate-800 text-sm">
          Duplicate SKU Master records are not allowed. Duplicate detection uses `sku_code + batch + expiry + mfd + mrp`.
          GTIN is optional and may repeat.
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="border-gray-200 xl:col-span-1 p-6">
          <div className="flex items-center gap-2 mb-4">
            <PackagePlus className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Create SKU Master</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sku_code">SKU Code *</Label>
              <Input
                id="sku_code"
                value={form.sku_code}
                onChange={(e) => updateField('sku_code', e.target.value)}
                placeholder="Ciplox 400 mg 10 tab strip"
              />
            </div>
            <div>
              <Label htmlFor="gtin">GTIN</Label>
              <Input
                id="gtin"
                value={form.gtin}
                onChange={(e) => updateField('gtin', e.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder="Optional GTIN"
              />
            </div>
            <div>
              <Label htmlFor="batch">Batch *</Label>
              <Input id="batch" value={form.batch} onChange={(e) => updateField('batch', e.target.value)} placeholder="BATCH-APR-2026" />
            </div>
            <div>
              <Label htmlFor="expiry">Expiry *</Label>
              <Input id="expiry" type="date" value={form.expiry} onChange={(e) => updateField('expiry', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mfd">Manufacturing Date</Label>
              <Input id="mfd" type="date" value={form.mfd} onChange={(e) => updateField('mfd', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mrp">MRP</Label>
              <Input id="mrp" value={form.mrp} onChange={(e) => updateField('mrp', e.target.value)} placeholder="125.00" />
            </div>
            <Button type="button" onClick={handleCreate} disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-700">
              {submitting ? 'Creating...' : 'Create SKU Master'}
            </Button>
          </div>
        </Card>

        <div className="xl:col-span-2 space-y-6">
          <Card className="border-gray-200 p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Bulk Upload SKU Master</h2>
                <p className="text-sm text-gray-600">
                  CSV fields must match the manual SKU form exactly. Duplicate SKU rows will be rejected. GTIN may repeat.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="unit-sku-master-upload"
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                    e.currentTarget.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={importing}
                  className="border-gray-300"
                  onClick={() => {
                    const input = document.getElementById('unit-sku-master-upload') as HTMLInputElement | null;
                    input?.click();
                  }}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {importing ? 'Uploading...' : 'Upload CSV'}
                </Button>
              </div>
            </div>

            {importSummary && (
              <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Import Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-gray-600">Total Rows</div>
                    <div className="text-lg font-semibold text-gray-900">{importSummary.total}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Inserted</div>
                    <div className="text-lg font-semibold text-green-600">{importSummary.inserted}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Duplicates</div>
                    <div className="text-lg font-semibold text-amber-600">{importSummary.duplicates}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Invalid</div>
                    <div className="text-lg font-semibold text-red-600">{importSummary.invalid}</div>
                  </div>
                </div>
                {importSummary.errors.length > 0 && (
                  <div className="mt-4 max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-2 py-1 text-left">Row</th>
                          <th className="px-2 py-1 text-left">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {importSummary.errors.map((err, index) => (
                          <tr key={`${err.row}-${index}`} className="border-b">
                            <td className="px-2 py-1">{err.row}</td>
                            <td className="px-2 py-1">{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Created SKU Master Records</h2>
                <p className="text-sm text-gray-600">Delete removes the record from future Unit generation and preserves historical generated codes.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search SKU Master..."
                  className="pl-10"
                />
              </div>
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm text-gray-600">Loading SKU Master records...</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-600">No SKU Master records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">SKU Code</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">GTIN</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Batch</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Expiry</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">MFD</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">MRP</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Created</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Delete SKU</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.sku_code}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-700">{item.gtin || 'PIC / no GTIN'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.batch}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(item.expiry)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(item.mfd)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.mrp || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(item.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(item)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

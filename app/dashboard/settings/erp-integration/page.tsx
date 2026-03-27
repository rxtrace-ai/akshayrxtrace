'use client';

import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle, Upload, FileText, Info } from 'lucide-react';
import { saveAs } from 'file-saver';

type IngestionResult = {
  total: number;
  imported: number;
  skipped: number;
  duplicates: number;
  invalid: number;
  errors: Array<{ row: number; error: string }>;
};

function buildImportIdempotencyKey(kind: 'unit' | 'sscc', file: File) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `erp:${kind}:${safeName}:${file.size}:${file.lastModified}`;
}

export default function ErpIntegrationPage() {
  const [activeTab, setActiveTab] = useState<'unit' | 'sscc'>('unit');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [ingestionMode, setIngestionMode] = useState<'unit' | 'sscc' | 'both' | null>(null);
  const [loadingMode, setLoadingMode] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  // Load current ingestion mode from company profile
  useEffect(() => {
    async function loadIngestionMode() {
      try {
        const res = await fetch('/api/company/erp-ingestion-mode', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(payload?.error?.message || payload?.error || 'Failed to load ingestion mode');
        }

        const mode = payload?.ingestion_mode ?? payload?.data?.ingestion_mode ?? null;
        if (mode === 'unit' || mode === 'sscc' || mode === 'both') {
          setIngestionMode(mode);
        }
      } catch (err) {
        console.error('Failed to load ingestion mode:', err);
      } finally {
        setLoadingMode(false);
      }
    }
    loadIngestionMode();
  }, []);

  // Save ingestion mode when changed
  useEffect(() => {
    if (loadingMode || ingestionMode === null) return;

    async function saveIngestionMode() {
      setSavingMode(true);
      try {
        const res = await fetch('/api/company/erp-ingestion-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingestion_mode: ingestionMode }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(payload?.error?.message || payload?.error || 'Failed to save ingestion mode');
        }
      } catch (err) {
        console.error('Failed to save ingestion mode:', err);
        setError((err as Error)?.message || 'Failed to save ERP ingestion mode');
      } finally {
        setSavingMode(false);
      }
    }

    // Debounce save
    const timeoutId = setTimeout(saveIngestionMode, 500);
    return () => clearTimeout(timeoutId);
  }, [ingestionMode, loadingMode]);

  // Unit CSV Template Download
  function downloadUnitCSVTemplate() {
    const headers = [
      'sku_code',
      'batch',
      'expiry_date',
      'serial_number',
      'gtin',
      'mrp',
      'mfd'
    ];

    const exampleRow = [
      'Ciplox 400 mg 10 tab strip',
      'BATCH123',
      '2025-12-31',
      'SN123456789',
      '89012345678901',
      '100.00',
      '2024-01-15'
    ];

    const csv = Papa.unparse([headers, exampleRow], { header: true });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `ERP_UNIT_INGESTION_TEMPLATE_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`);
  }

  // SSCC CSV Template Download
  function downloadSSCCCSVTemplate() {
    const headers = [
      'sscc',
      'sku_code',
      'batch',
      'hierarchy_level',
      'parent_sscc'
    ];

    const exampleRow = [
      '123456789012345678',
      'Ciplox 400 mg 10 tab strip',
      'BATCH123',
      'PALLET',
      ''
    ];

    const csv = Papa.unparse([headers, exampleRow], { header: true });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `ERP_SSCC_INGESTION_TEMPLATE_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`);
  }

  async function handleUnitCSVUpload(file: File) {
    setError(null);
    setSuccess(null);
    setResult(null);
    setProcessing(true);

    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      
      if (parsed.data.length === 0) {
        throw new Error('CSV file is empty or has no valid rows');
      }

      // Convert parsed rows to API format
      const rows = parsed.data.map(row => ({
        sku_code: row.sku_code || row.SKU_CODE || '',
        batch: row.batch || row.BATCH || row.batch_number || '',
        expiry_date: row.expiry_date || row.EXPIRY_DATE || row.exp || '',
        serial_number: row.serial_number || row.SERIAL_NUMBER || row.serial || '',
        gtin: row.gtin || row.GTIN || undefined,
        mrp: row.mrp || row.MRP || undefined,
        mfd: row.mfd || row.MFD || row.mfg_date || undefined,
      }));

      const res = await fetch('/api/erp/ingest/unit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': buildImportIdempotencyKey('unit', file),
        },
        body: JSON.stringify({ rows }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to import ERP unit codes');
      }

      setResult(data.results);
      setSuccess(data.message || `Imported ${data.results?.imported || 0} unit codes successfully`);
    } catch (err: any) {
      setError(err.message || 'Failed to process ERP unit CSV');
    } finally {
      setProcessing(false);
    }
  }

  async function handleSSCCCSVUpload(file: File) {
    setError(null);
    setSuccess(null);
    setResult(null);
    setProcessing(true);

    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      
      if (parsed.data.length === 0) {
        throw new Error('CSV file is empty or has no valid rows');
      }

      // Convert parsed rows to API format
      const rows = parsed.data.map(row => ({
        sscc: row.sscc || row.SSCC || '',
        sku_code: row.sku_code || row.SKU_CODE || '',
        batch: row.batch || row.BATCH || row.batch_number || '',
        hierarchy_level: row.hierarchy_level || row.HIERARCHY_LEVEL || '',
        parent_sscc: row.parent_sscc || row.PARENT_SSCC || undefined,
      }));

      const res = await fetch('/api/erp/ingest/sscc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': buildImportIdempotencyKey('sscc', file),
        },
        body: JSON.stringify({ rows }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to import ERP SSCC codes');
      }

      setResult(data.results);
      setSuccess(data.message || `Imported ${data.results?.imported || 0} SSCC codes successfully`);
    } catch (err: any) {
      setError(err.message || 'Failed to process ERP SSCC CSV');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">ERP Integration</h1>
        <p className="text-sm text-gray-600">
          Import and register already-generated ERP serialization data into RxTrace
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          <strong>ERP Code Ingestion:</strong> Import codes generated by your ERP system via CSV upload.
          This page is separate from SKU Master creation. All imported codes are validated, duplicate-checked, and registered with source = ERP for audit tracking.
        </AlertDescription>
      </Alert>

      {/* R4: Owner-only notice */}
      <Alert className="bg-amber-50 border-amber-200">
        <Info className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          ERP code ingestion is available to the company owner only. Team members (seat users) cannot configure or import codes—please contact your administrator.
        </AlertDescription>
      </Alert>

      {/* Alerts */}
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

      {/* ERP Ingestion Method Selection */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">ERP Ingestion Method Configuration</CardTitle>
          <CardDescription>
            Select which ERP code ingestion methods you want to enable for your company
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Enabled Ingestion Methods:</Label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ingestionMode === 'unit' || ingestionMode === 'both'}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      setIngestionMode(ingestionMode === 'sscc' ? 'both' : 'unit');
                    } else {
                      setIngestionMode(ingestionMode === 'both' ? 'sscc' : null);
                    }
                  }}
                  disabled={loadingMode || savingMode}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Unit-Level Code Ingestion</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ingestionMode === 'sscc' || ingestionMode === 'both'}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      setIngestionMode(ingestionMode === 'unit' ? 'both' : 'sscc');
                    } else {
                      setIngestionMode(ingestionMode === 'both' ? 'unit' : null);
                    }
                  }}
                  disabled={loadingMode || savingMode}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">SSCC Code Ingestion</span>
              </label>
            </div>
            <p className="text-xs text-gray-500">
              You can enable one or both ingestion methods. Changes are saved automatically.
            </p>
          </div>
          {savingMode && (
            <div className="text-sm text-blue-600">Saving configuration...</div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'unit' | 'sscc')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="unit">Unit-Level ERP Code Ingestion</TabsTrigger>
          <TabsTrigger value="sscc">SSCC ERP Code Ingestion</TabsTrigger>
        </TabsList>

        {/* Unit-Level Tab */}
        <TabsContent value="unit" className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Unit-Level ERP Code Ingestion</CardTitle>
              <CardDescription>
                Import unit-level codes (serial numbers) generated by your ERP system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CSV Template Download */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Download CSV Template</h4>
                    <p className="text-xs text-gray-600">
                      Use this template to prepare your unit-level ERP GS1 code data using the SKU Master `sku_code` business string
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={downloadUnitCSVTemplate}
                    className="border-gray-300"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              </div>

              {/* CSV Column Requirements */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">CSV Column Requirements</h4>
                <div className="text-xs text-gray-700 space-y-1">
                  <p><strong>Required:</strong> sku_code, batch, expiry_date, serial_number, gtin</p>
                  <p><strong>Optional:</strong> mrp, mfd (manufacturing date)</p>
                  <p><strong>sku_code format:</strong> use the full SKU Master business string, for example <code>Ciplox 400 mg 10 tab strip</code>. Do not use an internal SKU ID.</p>
                  <p className="text-amber-700 mt-2">
                    <strong>Note:</strong> Unit ERP ingestion accepts GS1/GTIN-based codes only. One row = one unit code. Quantity is determined by the number of rows in the CSV.
                    Duplicate rows with the same GTIN and serial number for the same company will be disqualified.
                  </p>
                </div>
              </div>

              {/* CSV Upload */}
              <div>
                <Label htmlFor="unit-csv-upload">Upload Unit-Level CSV File</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="unit-csv-upload"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUnitCSVUpload(file);
                      e.currentTarget.value = '';
                    }}
                    disabled={processing}
                  />
                </div>
              </div>

              {processing && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  Processing ERP unit CSV file...
                </div>
              )}

              {/* Results */}
              {result && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Import Results</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div>
                      <div className="text-gray-600">Total</div>
                      <div className="text-lg font-semibold text-gray-900">{result.total}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Imported</div>
                      <div className="text-lg font-semibold text-green-600">{result.imported}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Duplicates</div>
                      <div className="text-lg font-semibold text-amber-600">{result.duplicates}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Skipped</div>
                      <div className="text-lg font-semibold text-gray-600">{result.skipped}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Invalid</div>
                      <div className="text-lg font-semibold text-red-600">{result.invalid}</div>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-red-800 mb-2">Validation Errors:</p>
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-red-100">
                            <tr>
                              <th className="px-2 py-1 text-left">Row</th>
                              <th className="px-2 py-1 text-left">Error</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {result.errors.map((err, idx) => (
                              <tr key={idx} className="border-b">
                                <td className="px-2 py-1">{err.row}</td>
                                <td className="px-2 py-1 text-red-700">{err.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SSCC Tab */}
        <TabsContent value="sscc" className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">SSCC ERP Code Ingestion</CardTitle>
              <CardDescription>
                Import SSCC codes (logistics units) generated by your ERP system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CSV Template Download */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Download CSV Template</h4>
                    <p className="text-xs text-gray-600">
                      Use this template to prepare your SSCC ERP code data using the SKU Master `sku_code` business string
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={downloadSSCCCSVTemplate}
                    className="border-gray-300"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              </div>

              {/* CSV Column Requirements */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">CSV Column Requirements</h4>
                <div className="text-xs text-gray-700 space-y-1">
                  <p><strong>Required:</strong> sscc (18 digits), sku_code, batch, hierarchy_level (BOX/CARTON/PALLET)</p>
                  <p><strong>Optional:</strong> parent_sscc (for BOX or CARTON to link to parent)</p>
                  <p><strong>sku_code format:</strong> use the full SKU Master business string, for example <code>Ciplox 400 mg 10 tab strip</code>. Do not use an internal SKU ID.</p>
                  <p className="text-amber-700 mt-2">
                    <strong>Note:</strong> One row = one SSCC code. Hierarchy levels must be: BOX, CARTON, or PALLET.
                    Parent-child relationships are validated (Box → Carton → Pallet).
                  </p>
                </div>
              </div>

              {/* CSV Upload */}
              <div>
                <Label htmlFor="sscc-csv-upload">Upload SSCC CSV File</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="sscc-csv-upload"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleSSCCCSVUpload(file);
                      e.currentTarget.value = '';
                    }}
                    disabled={processing}
                  />
                </div>
              </div>

              {processing && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  Processing ERP SSCC CSV file...
                </div>
              )}

              {/* Results */}
              {result && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Import Results</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div>
                      <div className="text-gray-600">Total</div>
                      <div className="text-lg font-semibold text-gray-900">{result.total}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Imported</div>
                      <div className="text-lg font-semibold text-green-600">{result.imported}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Duplicates</div>
                      <div className="text-lg font-semibold text-amber-600">{result.duplicates}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Skipped</div>
                      <div className="text-lg font-semibold text-gray-600">{result.skipped}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Invalid</div>
                      <div className="text-lg font-semibold text-red-600">{result.invalid}</div>
                    </div>
                  </div>

                  {result.errors.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-red-800 mb-2">Validation Errors:</p>
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-red-100">
                            <tr>
                              <th className="px-2 py-1 text-left">Row</th>
                              <th className="px-2 py-1 text-left">Error</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {result.errors.map((err, idx) => (
                              <tr key={idx} className="border-b">
                                <td className="px-2 py-1">{err.row}</td>
                                <td className="px-2 py-1 text-red-700">{err.error}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

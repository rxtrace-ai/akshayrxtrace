'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, FileText, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import GenerateLabel from '@/lib/generateLabel';
import { buildGs1ElementString } from '@/lib/gs1Builder';
// Printer integration removed - now handled separately via Settings → Printer Integration
import QRCodeComponent from '@/components/custom/QRCodeComponent';
import DataMatrixComponent from '@/components/custom/DataMatrixComponent';
import { supabaseClient } from '@/lib/supabase/client';
import { exportLabels as exportLabelsUtil, LabelData } from '@/lib/labelExporter';
import { useSubscription } from '@/lib/hooks/useSubscription';

// ---------- Types ----------
type Gs1Fields = {
  gtin: string;
  mfdYYMMDD?: string;
  expiryYYMMDD?: string;
  batch?: string;
  mrp?: string;
  sku?: string;
  company?: string;
  serial?: string;
};

type CodeType = 'QR' | 'DATAMATRIX';

type UnitFormState = {
  sku: string;
  batch: string;
  expiryDate: string;
  quantity: number;
  codeType: CodeType;
  gtin?: string; // optional; if present => GS1 mode, else PIC mode
  mfdDate?: string;
  mrp?: string;
  complianceAck: boolean;
};

type UnitBatchRow = {
  id: string;
  fields: Gs1Fields;
  payload: string;
  codeMode?: 'GS1' | 'PIC';
  codeType: CodeType;
};

type CSVValidationError = {
  row: number;
  column: string;
  message: string;
};

const MAX_CODES_PER_REQUEST = 10000;
const MAX_CODES_PER_ROW = 1000;

// ---------- Helpers ----------
function isoDateToYYMMDD(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function normalizeCsvDate(raw?: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;

  // Preferred format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // YYMMDD -> 20YY-MM-DD
  if (/^\d{6}$/.test(value)) {
    const yy = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const dd = value.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }

  // DDMMYYYY -> YYYY-MM-DD
  if (/^\d{8}$/.test(value)) {
    const dd = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const yyyy = value.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

// ---------- CSV Template Generation ----------
function downloadUnitCSVTemplate(companyName: string, companyId: string) {
  const headers = [
    'Company Name',
    'Company ID',
    'Generation Type',
    'Code Format',
    'GTIN (Optional - leave blank for PIC)',
    'SKU Code',
    'Batch Number',
    'Expiry Date (YYYY-MM-DD)',
    'Quantity',
    'Product Name',
    'MRP',
    'Manufacturing Date (YYYY-MM-DD)'
  ];

  const exampleRow = [
    companyName,
    companyId,
    'UNIT',
    'QR',
    '1234567890123',
    'SKU001',
    'BATCH123',
    '2025-12-31',
    '10',
    'Paracetamol 650mg',
    '100.00',
    '2024-01-15'
  ];

  const csv = Papa.unparse([headers, exampleRow], { header: true });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `UNIT_CODE_GENERATION_TEMPLATE_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`);
}

// ---------- CSV Validation ----------
function validateUnitCSV(rows: Record<string, string>[], companyId: string): { valid: boolean; errors: CSVValidationError[] } {
  const errors: CSVValidationError[] = [];
  let totalRequested = 0;
  
  rows.forEach((row, index) => {
    const rowNum = index + 2; // +2 because row 1 is header, and index is 0-based
    
    // Required fields
    if (!row['SKU Code']?.trim() && !row['sku_code']?.trim() && !row['SKU']?.trim()) {
      errors.push({ row: rowNum, column: 'SKU Code', message: 'SKU Code is required' });
    }
    
    if (!row['Batch Number']?.trim() && !row['batch_number']?.trim() && !row['BATCH']?.trim()) {
      errors.push({ row: rowNum, column: 'Batch Number', message: 'Batch Number is required' });
    }
    
    if (!row['Expiry Date']?.trim() && !row['expiry_date']?.trim() && !row['EXP']?.trim()) {
      errors.push({ row: rowNum, column: 'Expiry Date', message: 'Expiry Date is required' });
    }
    
    const qtyStr = row['Quantity'] || row['quantity'] || row['QTY'] || '1';
    const qty = parseInt(qtyStr, 10);
    if (isNaN(qty) || qty < 1) {
      errors.push({ row: rowNum, column: 'Quantity', message: 'Quantity must be a positive integer' });
    } else {
      if (qty > MAX_CODES_PER_ROW) {
        errors.push({
          row: rowNum,
          column: 'Quantity',
          message: `Quantity per row cannot exceed ${MAX_CODES_PER_ROW.toLocaleString()} codes`,
        });
      }
      totalRequested += qty;
    }
    
    const expiryDate = row['Expiry Date'] || row['expiry_date'] || row['EXP'] || '';
    if (expiryDate && !normalizeCsvDate(expiryDate)) {
      errors.push({ row: rowNum, column: 'Expiry Date', message: 'Expiry Date must be YYYY-MM-DD (DDMMYYYY/YYMMDD are also accepted and normalized)' });
    }
  });

  if (totalRequested > MAX_CODES_PER_REQUEST) {
    errors.push({
      row: 0,
      column: 'Quantity',
      message: `Total requested codes cannot exceed ${MAX_CODES_PER_REQUEST.toLocaleString()} per upload (current total: ${totalRequested.toLocaleString()})`,
    });
  }
  
  return { valid: errors.length === 0, errors };
}

// ---------- CSV Processing ----------
async function processUnitCSV(csvText: string, companyId: string, companyName: string): Promise<UnitBatchRow[]> {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const out: UnitBatchRow[] = [];
  const { validateGTIN } = await import('@/lib/gs1/gtin');

  for (let idx = 0; idx < parsed.data.length; idx++) {
    const row = parsed.data[idx];
    const sku = (row['SKU Code'] || row['sku_code'] || row['SKU'] || '').toString().trim();
    const batch = (row['Batch Number'] || row['batch_number'] || row['BATCH'] || '').toString().trim();
    const expRaw = (row['Expiry Date'] || row['expiry_date'] || row['EXP'] || '').toString().trim();
    const qty = Math.max(1, parseInt((row['Quantity'] || row['quantity'] || row['QTY'] || '1').toString(), 10) || 1);
    const mrp = (row['MRP'] || row['mrp'] || '').toString().trim();
    const mfdRaw = (row['Manufacturing Date'] || row['mfd'] || row['MFD'] || '').toString().trim();
    const gtinRaw = (row['GTIN (Optional - leave blank for PIC)'] || row['GTIN'] || row['gtin'] || '').toString().trim();
    const codeType: CodeType = ((row['Code Format'] || row['code_format'] || 'QR').toString().toUpperCase() === 'DATAMATRIX') ? 'DATAMATRIX' : 'QR';
    
    // Optional GTIN: validate if provided, else PIC mode for this row.
    let gtin: string | undefined = undefined;
    if (gtinRaw) {
      const validation = validateGTIN(gtinRaw);
      if (!validation.valid) {
        throw new Error(`Row ${idx + 2}: ${validation.error || 'Invalid GTIN'}`);
      }
      gtin = validation.normalized!;
    }
    
    const mfdISO = normalizeCsvDate(mfdRaw);
    const expISO = normalizeCsvDate(expRaw);
    if (!expISO) {
      throw new Error(`Row ${idx + 2}: Expiry Date must be YYYY-MM-DD`);
    }
    if (mfdRaw && !mfdISO) {
      throw new Error(`Row ${idx + 2}: Manufacturing Date must be YYYY-MM-DD`);
    }

    // Keep SKU master updated (non-blocking)
    if (sku) {
      try {
        await fetch('/api/skus/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku_code: sku, gtin: gtin || undefined }),
        });
      } catch {
        // ignore
      }
    }

    // Generate unit codes via API
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compliance_ack: true,
        gtin: gtin || undefined,
        batch,
        mfd: mfdISO || null,
        exp: expISO,
        quantity: qty,
        mrp: mrp || undefined,
        sku: sku || undefined,
        company: companyName || undefined
      })
    });

    // Safe JSON parsing - check response status and content-type
    if (!res.ok) {
      const contentType = res.headers.get('content-type');
      let errorMessage = `Unable to generate codes for SKU ${sku}. Please retry.`;
      
      if (contentType?.includes('application/json')) {
        try {
          const errorBody = await res.json().catch(() => ({}));
          errorMessage = errorBody.error || errorMessage;
        } catch {
          // Ignore JSON parse error, use default message
        }
      } else {
        const text = await res.text().catch(() => '');
        if (text) errorMessage = text;
      }
      
      throw new Error(errorMessage);
    }

    // Check content-type before parsing JSON
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error('Unit code generation failed. Invalid response format. Please try again or contact support.');
    }

    const result = await res.json().catch(() => {
      throw new Error('Unit code generation failed. Invalid response. Please try again or contact support.');
    });

    // Validate response structure
    if (!result || !Array.isArray(result.items)) {
      throw new Error('Unit code generation failed. Invalid response format. Please try again or contact support.');
    }
    result.items.forEach((item: any) => {
      out.push({
        id: `r${out.length + 1}`,
        fields: {
          gtin: gtin || 'PIC',
          mfdYYMMDD: isoDateToYYMMDD(mfdISO),
          expiryYYMMDD: isoDateToYYMMDD(expISO),
          batch: batch || undefined,
          mrp: mrp || undefined,
          sku: sku || undefined,
          company: companyName || undefined,
          serial: item.serial
        },
        payload: item.payload || item.gs1,
        codeMode: item.code_mode || undefined,
        codeType: codeType
      });
    });
  }

  return out;
}

// ---------- Export Functions ----------
function exportUnitCodesCSV(batch: UnitBatchRow[]): void {
  const rows = batch.map((item, idx) => ({
    'Row Number': idx + 1,
    'GTIN': item.fields.gtin,
    'Serial Number': item.fields.serial || '',
    'Batch Number': item.fields.batch || '',
    'Expiry Date': item.fields.expiryYYMMDD || '',
    'SKU Code': item.fields.sku || '',
    'Code Mode': item.codeMode || '',
    'Payload': item.payload,
    'Code Format': item.codeType,
    'Company Name': item.fields.company || ''
  }));

  const csv = Papa.unparse(rows, { header: true });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const filename = `UNIT_CODE_GENERATION_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
  saveAs(blob, filename);
}

// ---------- Main Component ----------
export default function UnitCodeGenerationPage() {
  const { subscription, isFeatureEnabled, loading: subscriptionLoading } = useSubscription();
  const canGenerate = isFeatureEnabled('code_generation');
  const [form, setForm] = useState<UnitFormState>({
    sku: '',
    batch: '',
    expiryDate: '',
    quantity: 1,
    codeType: 'QR',
    gtin: '',
    mfdDate: '',
    mrp: '',
    complianceAck: false,
  });

  const [batch, setBatch] = useState<UnitBatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [company, setCompany] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvValidation, setCsvValidation] = useState<{ valid: boolean; errors: CSVValidationError[] } | null>(null);
  const [csvProcessing, setCsvProcessing] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState(false);
  const [skus, setSkus] = useState<Array<{ id: string; sku_code: string; sku_name: string | null }>>([]);
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabaseClient().auth.getUser();
      if (user) {
        const { data } = await supabaseClient()
          .from('companies')
          .select('id, company_name, profile_completed')
          .eq('user_id', user.id)
          .single();
        if (data?.company_name) {
          setCompany(data.company_name);
          setCompanyId(data.id);
        }
        if (data?.profile_completed !== undefined) {
          setProfileCompleted(data.profile_completed);
        }

        // Fetch SKUs
        const skuRes = await fetch('/api/skus', { cache: 'no-store' });
        const skuData = await skuRes.json();
        if (skuData?.skus) {
          setSkus(skuData.skus);
        }
      }
    })();
  }, []);

  function update<K extends keyof UnitFormState>(k: K, v: UnitFormState[K]) {
    setForm(s => ({ ...s, [k]: v }));
  }

  const singlePerRowExceeded = form.quantity > MAX_CODES_PER_ROW;
  const singleRequestExceeded = form.quantity > MAX_CODES_PER_REQUEST;
  const singleLimitError = singlePerRowExceeded
    ? `Per entry limit is ${MAX_CODES_PER_ROW.toLocaleString()} codes.`
    : singleRequestExceeded
      ? `Per request limit is ${MAX_CODES_PER_REQUEST.toLocaleString()} codes.`
      : null;

  /**
   * Type-safe GTIN resolution helper.
   * Resolves GTIN from multiple possible sources with priority:
   * 1. Validated/normalized GTIN (highest priority)
   * 2. Raw GTIN input (if present)
   * 3. Generated rows (extract from first row)
   * Returns null if no valid GTIN can be resolved.
   * NEVER throws - safe for use in UI messages.
   */
  function resolveDisplayGtin(params: {
    validatedGtin?: string | null;
    normalizedGtin?: string | null;
    rawGtinInput?: string | null;
    generatedRows?: UnitBatchRow[];
  }): string | null {
    // Priority 1: Validated/normalized GTIN
    if (params.validatedGtin && typeof params.validatedGtin === 'string' && params.validatedGtin.trim().length > 0) {
      return params.validatedGtin.trim();
    }
    if (params.normalizedGtin && typeof params.normalizedGtin === 'string' && params.normalizedGtin.trim().length > 0) {
      return params.normalizedGtin.trim();
    }
    
    // Priority 2: Raw GTIN input
    if (params.rawGtinInput && typeof params.rawGtinInput === 'string' && params.rawGtinInput.trim().length > 0) {
      return params.rawGtinInput.trim();
    }
    
    // Priority 3: Extract from generated rows
    if (params.generatedRows && Array.isArray(params.generatedRows) && params.generatedRows.length > 0) {
      const firstRow = params.generatedRows[0];
      if (firstRow?.fields?.gtin && typeof firstRow.fields.gtin === 'string' && firstRow.fields.gtin.trim().length > 0) {
        return firstRow.fields.gtin.trim();
      }
    }
    
    return null;
  }

  async function handleGenerateSingle() {
    setError(null);
    setSuccess(null);

    if (!form.sku || !form.batch || !form.expiryDate) {
      setError('SKU Code, Batch Number, and Expiry Date are required');
      return;
    }
    if (!form.complianceAck) {
      setError('You must confirm compliance to generate codes.');
      return;
    }
    if (form.quantity > MAX_CODES_PER_ROW) {
      setError(`Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`);
      return;
    }
    if (form.quantity > MAX_CODES_PER_REQUEST) {
      setError(`Per request limit exceeded. Maximum ${MAX_CODES_PER_REQUEST.toLocaleString()} codes per request.`);
      return;
    }

    try {
      setGeneratingSingle(true);
      // Optional GTIN: when present => GS1 mode, else PIC mode
      let gtin: string | undefined = undefined;
      if (form.gtin && form.gtin.trim().length > 0) {
        const { validateGTIN } = await import('@/lib/gs1/gtin');
        const validation = validateGTIN(form.gtin);
        if (!validation.valid) {
          setError(validation.error || 'Invalid GTIN. Please verify the number.');
          return;
        }
        gtin = validation.normalized!;
      }
      
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compliance_ack: true,
          gtin: gtin || undefined,
          batch: form.batch,
          mfd: form.mfdDate || null,
          exp: form.expiryDate,
          quantity: form.quantity,
          mrp: form.mrp || undefined,
          sku: form.sku || undefined,
          company: company || undefined
        })
      });

      // Safe JSON parsing - check response status and content-type
      if (!res.ok) {
        const contentType = res.headers.get('content-type');
        let errorMessage = 'Unable to generate unit codes right now. Please retry.';
        
        if (contentType?.includes('application/json')) {
          try {
            const errorBody = await res.json().catch(() => ({}));
            errorMessage = errorBody.error || errorMessage;
          } catch {
            // Ignore JSON parse error, use default message
          }
        } else {
          const text = await res.text().catch(() => '');
          if (text) errorMessage = text;
        }
        
        throw new Error(errorMessage);
      }

      // Check content-type before parsing JSON
      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        throw new Error('Unit code generation failed. Invalid response format. Please try again or contact support.');
      }

      const result = await res.json().catch(() => {
        throw new Error('Unit code generation failed. Invalid response. Please try again or contact support.');
      });

      // Validate response structure
      if (!result || !Array.isArray(result.items)) {
        throw new Error('Unit code generation failed. Invalid response format. Please try again or contact support.');
      }
      const newRows: UnitBatchRow[] = result.items.map((item: any, idx: number) => ({
        id: `s${batch.length + idx + 1}`,
        fields: {
          gtin: gtin || 'PIC',
          mfdYYMMDD: isoDateToYYMMDD(form.mfdDate),
          expiryYYMMDD: isoDateToYYMMDD(form.expiryDate),
          batch: form.batch,
          mrp: form.mrp,
          sku: form.sku,
          company: company || undefined,
          serial: item.serial
        },
        payload: item.payload || item.gs1,
        codeMode: item.code_mode || undefined,
        codeType: form.codeType
      }));

      setBatch(prev => [...prev, ...newRows]);
      
      // Resolve GTIN for display using type-safe helper
      const displayGtin = gtin || null;
      
      const successMessage = displayGtin
        ? `Generated ${newRows.length} unit code(s) successfully. GTIN used: ${displayGtin}`
        : `Generated ${newRows.length} unit code(s) successfully in PIC mode (no GTIN).`;
      
      setSuccess(successMessage);
    } catch (e: any) {
      setError(e?.message || 'Unable to generate unit codes right now. Please try again.');
    } finally {
      setGeneratingSingle(false);
    }
  }

  async function handleCSVUpload(file: File) {
    setError(null);
    setSuccess(null);
    setCsvValidation(null);
    setCsvFile(file);

    if (!canGenerate) {
      setError('Code generation is disabled. This feature is available only during an active trial in pilot mode.');
      return;
    }
    if (!form.complianceAck) {
      setError('You must confirm compliance to generate codes.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      
      // Validate CSV
      const validation = validateUnitCSV(parsed.data, companyId);
      setCsvValidation(validation);

      if (!validation.valid) {
        setError(`CSV validation failed. Please fix ${validation.errors.length} error(s) before generating codes.`);
        return;
      }

      // Process CSV
      setCsvProcessing(true);
      const rows = await processUnitCSV(text, companyId, company);
      setBatch(prev => [...prev, ...rows]);
      setSuccess(`Processed CSV: Generated ${rows.length} unit code(s)`);
    } catch (e: any) {
      setError(e?.message || 'Unable to process CSV right now. Please try again.');
    } finally {
      setCsvProcessing(false);
    }
  }

  function batchToLabelData(): LabelData[] {
    return batch.map(item => ({
      id: item.id,
      payload: item.payload,
      codeType: item.codeType,
      displayText: `GTIN: ${item.fields.gtin} | Batch: ${item.fields.batch || 'N/A'} | Serial: ${item.fields.serial || 'N/A'}`,
      metadata: item.fields
    }));
  }

  async function handleExport(format: 'PDF' | 'PNG' | 'ZPL' | 'EPL' | 'ZIP' | 'PRINT') {
    if (!batch.length) return;
    setError(null);
    try {
      const labels = batchToLabelData();
      await exportLabelsUtil(labels, format, `unit_labels_${Date.now()}`);
    } catch (e: any) {
      setError(e?.message || `Failed to export ${format}`);
    }
  }

  async function handlePrint() {
    if (!batch.length) return;
    setError(null);
    try {
      let printFormat: 'PDF' | 'EPL' | 'ZPL' = 'PDF';
      const formatChoice = prompt('Select print format:\n1. PDF (Opens OS print dialog)\n2. EPL (Download file)\n3. ZPL (Download file)\n\nEnter 1, 2, or 3:');
      if (formatChoice === '2') printFormat = 'EPL';
      else if (formatChoice === '3') printFormat = 'ZPL';
      else printFormat = 'PDF';

      const labels = batchToLabelData();
      if (printFormat === 'PDF') {
        await exportLabelsUtil(labels, 'PRINT', `unit_labels_${Date.now()}`);
      } else {
        await exportLabelsUtil(labels, printFormat, `unit_labels_${Date.now()}`);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to print');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">Unit-Level Code Generation</h1>
        <p className="text-sm text-gray-600">Generate GS1 (with GTIN) or PIC (without GTIN) unit-level codes</p>
      </div>

      {/* Subscription Status Alert */}
      {!subscriptionLoading && !canGenerate && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Code generation is disabled because trial access is not active. 
            This feature is available only during an active trial in pilot mode.
            <Button asChild variant="link" className="p-0 ml-2 h-auto">
              <Link href="/contact">Contact Sales →</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Action Relationship Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">How it works:</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-blue-800">
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
            <div>
              <strong>Generate</strong> — Creates codes in the system. Does not print or export.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">2</span>
            <div>
              <strong>Export</strong> — Downloads codes as files. Does not create new codes.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
            <div>
              <strong>Print</strong> — Sends to your printer. RxTrace does not control the printer.
            </div>
          </div>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Section - GENERATE CODES */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section Header: Generate Codes */}
          <div className="border-b border-gray-200 pb-4">
            <h2 className="text-xl font-semibold text-gray-900">Generate Codes</h2>
            <p className="text-sm text-gray-500 mt-1">
              This creates GS1 codes in the system. It does not print or export codes.
            </p>
          </div>

          {/* Single Generation Form */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Single Unit Generation</CardTitle>
              <CardDescription>Generate unit codes one at a time. Codes are saved immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="sku">SKU Code *</Label>
                  <Select value={form.sku} onValueChange={(v) => update('sku', v)}>
                    <SelectTrigger id="sku">
                      <SelectValue placeholder="Select SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {skus.map((s) => (
                        <SelectItem key={s.id} value={s.sku_code}>
                          {s.sku_code} {s.sku_name ? `- ${s.sku_name}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="batch">Batch Number *</Label>
                  <Input
                    id="batch"
                    value={form.batch}
                    onChange={(e) => update('batch', e.target.value)}
                    placeholder="BATCH123"
                  />
                </div>

                <div>
                  <Label htmlFor="expiry">Expiry Date *</Label>
                  <Input
                    id="expiry"
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => update('expiryDate', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    max={MAX_CODES_PER_ROW}
                    value={form.quantity}
                    onChange={(e) => update('quantity', parseInt(e.target.value) || 1)}
                  />
                  <p className={`text-xs mt-1 ${singleLimitError ? 'text-red-600' : 'text-gray-500'}`}>
                    Limit: up to {MAX_CODES_PER_ROW.toLocaleString()} per entry, {MAX_CODES_PER_REQUEST.toLocaleString()} per request.
                  </p>
                </div>

                <div>
                  <Label htmlFor="codeType">Code Format</Label>
                  <Select value={form.codeType} onValueChange={(v) => update('codeType', v as CodeType)}>
                    <SelectTrigger id="codeType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QR">QR Code</SelectItem>
                      <SelectItem value="DATAMATRIX">DataMatrix</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="gtin">
                    GTIN (Optional - 8-14 digits)
                  </Label>
                  {'customer' === 'customer' ? (
                    <>
                      <Input
                        id="gtin"
                        type="text"
                        value={form.gtin || ''}
                        onChange={(e) => {
                          // Only allow numeric input
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 14) {
                            update('gtin', value);
                            // Clear error when user types
                            if (error && error.includes('GTIN')) {
                              setError(null);
                            }
                          }
                        }}
                        placeholder="1234567890123"
                        maxLength={14}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Supported formats: GTIN-8 (8 digits), GTIN-12 (12 digits), GTIN-13 (13 digits), GTIN-14 (14 digits)
                      </p>
                    </>
                  ) : (
                    <>
                      <Input
                        id="gtin"
                        type="text"
                        value=""
                        readOnly
                        disabled
                        placeholder="GTIN will be generated by RxTrace Terminal"
                        className="bg-gray-50 text-gray-500 cursor-not-allowed"
                      />
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠️ Internal GTINs are valid for India only and may not be export compliant
                      </p>
                    </>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.complianceAck}
                      onChange={(e) => update('complianceAck', e.target.checked)}
                      className="mt-1"
                    />
                    <span>I confirm I understand and accept the compliance responsibility for generated codes.</span>
                  </label>
                  <p className="text-xs text-gray-500">
                    Codes are format-validated only. Ensure GTIN ownership and regulatory compliance before printing/using.
                  </p>
                </div>

                <div>
                  <Label htmlFor="mfd">Manufacturing Date (Optional)</Label>
                  <Input
                    id="mfd"
                    type="date"
                    value={form.mfdDate || ''}
                    onChange={(e) => update('mfdDate', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="mrp">MRP (Optional)</Label>
                  <Input
                    id="mrp"
                    type="text"
                    value={form.mrp || ''}
                    onChange={(e) => update('mrp', e.target.value)}
                    placeholder="100.00"
                  />
                </div>
              </div>


              <Button 
                onClick={handleGenerateSingle} 
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={!canGenerate || generatingSingle || !!singleLimitError || !form.complianceAck}
              >
                {generatingSingle ? 'Generating...' : 'Generate Unit Codes'}
              </Button>
              <p className="text-xs text-gray-500 text-center mt-2">
                Generates codes only. Use Export or Print for output.
              </p>
            </CardContent>
          </Card>

          {/* CSV Bulk Generation */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Bulk Unit Generation (CSV)</CardTitle>
              <CardDescription>Upload CSV file for bulk unit code generation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CSV Template Download */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Download CSV Template</h4>
                    <p className="text-xs text-gray-600">
                      Use this template to prepare your unit code generation data
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => downloadUnitCSVTemplate(company, companyId)}
                    className="border-gray-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              </div>

              {/* CSV Example Preview */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">CSV Column Requirements</h4>
                <div className="text-xs text-gray-700 space-y-1">
                  <p><strong>Required:</strong> SKU Code, Batch Number, Expiry Date, Quantity</p>
                  <p><strong>Optional:</strong> Product Name, MRP, Manufacturing Date, GTIN (if customer-provided)</p>
                  <p><strong>Auto-filled:</strong> Company Name, Company ID, Generation Type, Code Format</p>
                  <p><strong>Date format:</strong> YYYY-MM-DD (DDMMYYYY/YYMMDD will be normalized).</p>
                  <p className="text-blue-700"><strong>Limits:</strong> Max {MAX_CODES_PER_ROW.toLocaleString()} per CSV row and {MAX_CODES_PER_REQUEST.toLocaleString()} total per upload.</p>
                </div>
              </div>

              {/* CSV Upload */}
              <div>
                <Label htmlFor="csv-upload">Upload CSV File</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="csv-upload"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCSVUpload(file);
                      e.currentTarget.value = '';
                    }}
                    disabled={csvProcessing || !canGenerate}
                  />
                  {csvFile && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {csvFile.name}
                    </Badge>
                  )}
                </div>
              </div>

              {/* CSV Validation Results */}
              {csvValidation && (
                <div className={`p-4 rounded-lg border ${
                  csvValidation.valid 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {csvValidation.valid ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600" />
                    )}
                    <span className={`text-sm font-semibold ${
                      csvValidation.valid ? 'text-green-800' : 'text-red-800'
                    }`}>
                      {csvValidation.valid 
                        ? 'CSV validation passed' 
                        : `CSV validation failed: ${csvValidation.errors.length} error(s)`}
                    </span>
                  </div>
                  
                  {csvValidation.errors.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-red-800">Validation Errors:</p>
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-red-100">
                            <tr>
                              <th className="px-2 py-1 text-left">Row</th>
                              <th className="px-2 py-1 text-left">Column</th>
                              <th className="px-2 py-1 text-left">Error</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {csvValidation.errors.map((err, idx) => (
                              <tr key={idx} className="border-b">
                                <td className="px-2 py-1">{err.row}</td>
                                <td className="px-2 py-1">{err.column}</td>
                                <td className="px-2 py-1 text-red-700">{err.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {csvProcessing && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  Processing CSV file...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Side - Generated Codes, Export & Print */}
        <div className="lg:col-span-1 space-y-6">
          {/* Generated Codes Preview */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Generated Unit Codes</CardTitle>
              <CardDescription>{batch.length} unit code(s) generated</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
                {batch.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <FileText className="w-10 h-10 mx-auto mb-2" />
                    <p className="text-sm">No unit codes generated yet</p>
                    <p className="text-xs mt-1">Generate codes using the form</p>
                  </div>
                ) : (
                  batch.slice(0, 5).map((b) => (
                    <div key={b.id} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="text-xs font-mono text-gray-600 mb-2 break-all line-clamp-2">{b.payload}</div>
                      <div className="flex justify-center py-2 bg-white rounded overflow-hidden">
                        {b.codeType === 'QR' ? (
                          <QRCodeComponent value={b.payload} size={70} />
                        ) : (
                          <DataMatrixComponent value={b.payload} size={70} />
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-2">
                        GTIN: {b.fields.gtin} | Serial: {b.fields.serial || 'N/A'}
                      </div>
                    </div>
                  ))
                )}
                {batch.length > 5 && (
                  <div className="text-center text-sm text-gray-500 py-2">
                    + {batch.length - 5} more codes
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* EXPORT CODES - Separate Panel */}
          <Card className="border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">Export Codes</CardTitle>
              <CardDescription>
                Download generated codes as files. Exporting does not print or regenerate codes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batch.length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-sm">
                  Generate codes first
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    onClick={() => exportUnitCodesCSV(batch)}
                    variant="outline"
                    className="w-full border-gray-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    onClick={() => handleExport('PDF')}
                    variant="outline"
                    className="w-full border-gray-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export PDF
                  </Button>
                  <Button
                    onClick={() => handleExport('ZIP')}
                    variant="outline"
                    className="w-full border-gray-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export ZIP (PNGs)
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => handleExport('ZPL')}
                      variant="outline"
                      size="sm"
                      className="border-gray-300"
                    >
                      ZPL
                    </Button>
                    <Button
                      onClick={() => handleExport('EPL')}
                      variant="outline"
                      size="sm"
                      className="border-gray-300"
                    >
                      EPL
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 text-center pt-2">
                    Export downloads files. Does not print.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PRINT CODES - Separate Panel */}
          <Card className="border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">Print Codes</CardTitle>
              <CardDescription>
                Printing uses your computer or network printer. RxTrace does not control the physical printer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batch.length === 0 ? (
                <div className="text-center py-4 text-gray-400 text-sm">
                  Generate codes first
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    onClick={() => handlePrint()}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                  >
                    Print Codes
                  </Button>
                  <div className="text-xs text-gray-500 space-y-1">
                    <p><strong>PDF:</strong> Opens browser print dialog</p>
                    <p><strong>EPL/ZPL:</strong> Downloads printer file</p>
                  </div>
                  <p className="text-xs text-gray-400 text-center border-t pt-2">
                    Configure print format in Settings → Printers
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

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
import { Download, Upload, FileText, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';
import QRCodeComponent from '@/components/custom/QRCodeComponent';
import DataMatrixComponent from '@/components/custom/DataMatrixComponent';
import { supabaseClient } from '@/lib/supabase/client';
import { exportLabels as exportLabelsUtil, LabelData } from '@/lib/labelExporter';
import { useSubscription } from '@/lib/hooks/useSubscription';

// ---------- Types ----------
type CodeType = 'QR' | 'DATAMATRIX';
type GenerationLevel = 'BOX' | 'CARTON' | 'PALLET';

type SSCCLabel = {
  id: string;
  sscc: string;
  sscc_with_ai: string;
  sku_id: string;
  pallet_id: string;
  level: GenerationLevel;
};

type SSCCFormState = {
  skuId: string;
  batch: string;
  expiryDate: string;
  unitsPerBox: number;
  boxesPerCarton: number;
  cartonsPerPallet: number;
  numberOfPallets: number;
  codeType: CodeType;
  // Hierarchical level selection (checkboxes)
  generateBox: boolean;
  generateCarton: boolean;
  generatePallet: boolean;
  complianceAck: boolean;
};

type CSVValidationError = {
  row: number;
  column: string;
  message: string;
};

const MAX_CODES_PER_REQUEST = 10000;
const MAX_CODES_PER_ROW = 1000;

function normalizeCsvDate(raw?: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{6}$/.test(value)) {
    const yy = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const dd = value.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }
  if (/^\d{8}$/.test(value)) {
    const dd = value.slice(0, 2);
    const mm = value.slice(2, 4);
    const yyyy = value.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
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

// ---------- CSV Template Generation ----------
function downloadSSCCCSVTemplate(companyName: string, companyId: string) {
  const headers = [
    'Company Name',
    'Company ID',
    'Generation Type',
    'Hierarchy Type',
    'SKU Code',
    'Batch Number',
    'Expiry Date (YYYY-MM-DD)',
    'Units per Box',
    'Boxes per Carton',
    'Cartons per Pallet',
    'Number of Pallets'
  ];

  const exampleRow = [
    companyName,
    companyId,
    'SSCC',
    'PALLET',
    'SKU001',
    'BATCH123',
    '2025-12-31',
    '10',
    '12',
    '20',
    '5'
  ];

  const csv = Papa.unparse([headers, exampleRow], { header: true });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `SSCC_CODE_GENERATION_TEMPLATE_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`);
}

// ---------- CSV Validation ----------
function validateSSCCCSV(rows: Record<string, string>[], companyId: string): { valid: boolean; errors: CSVValidationError[] } {
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
    } else {
      const expRaw = row['Expiry Date'] || row['expiry_date'] || row['EXP'] || '';
      if (expRaw && !normalizeCsvDate(expRaw)) {
        errors.push({
          row: rowNum,
          column: 'Expiry Date',
          message: 'Expiry Date must be YYYY-MM-DD (DDMMYYYY/YYMMDD are also accepted and normalized)',
        });
      }
    }
    
    // Hierarchy quantities
    const unitsPerBox = parseInt(row['Units per Box'] || row['units_per_box'] || '0', 10);
    if (isNaN(unitsPerBox) || unitsPerBox < 1) {
      errors.push({ row: rowNum, column: 'Units per Box', message: 'Units per Box must be a positive integer' });
    }
    
    const boxesPerCarton = parseInt(row['Boxes per Carton'] || row['boxes_per_carton'] || '0', 10);
    if (isNaN(boxesPerCarton) || boxesPerCarton < 1) {
      errors.push({ row: rowNum, column: 'Boxes per Carton', message: 'Boxes per Carton must be a positive integer' });
    }
    
    const cartonsPerPallet = parseInt(row['Cartons per Pallet'] || row['cartons_per_pallet'] || '0', 10);
    if (isNaN(cartonsPerPallet) || cartonsPerPallet < 1) {
      errors.push({ row: rowNum, column: 'Cartons per Pallet', message: 'Cartons per Pallet must be a positive integer' });
    }
    
    const numberOfPallets = parseInt(row['Number of Pallets'] || row['number_of_pallets'] || '0', 10);
    if (isNaN(numberOfPallets) || numberOfPallets < 1) {
      errors.push({ row: rowNum, column: 'Number of Pallets', message: 'Number of Pallets must be a positive integer' });
    } else {
      if (numberOfPallets > MAX_CODES_PER_ROW) {
        errors.push({
          row: rowNum,
          column: 'Number of Pallets',
          message: `Per row limit exceeded: maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per row`,
        });
      }
      totalRequested += numberOfPallets;
    }
    
    // Validate date format
    const expiryDate = row['Expiry Date'] || row['expiry_date'] || row['EXP'] || '';
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && !/^\d{6}$/.test(expiryDate)) {
      errors.push({ row: rowNum, column: 'Expiry Date', message: 'Expiry Date must be YYYY-MM-DD or YYMMDD format' });
    }
  });

  if (totalRequested > MAX_CODES_PER_REQUEST) {
    errors.push({
      row: 0,
      column: 'Number of Pallets',
      message: `Total requested codes cannot exceed ${MAX_CODES_PER_REQUEST.toLocaleString()} per upload (current total: ${totalRequested.toLocaleString()})`,
    });
  }
  
  return { valid: errors.length === 0, errors };
}

// ---------- CSV Processing ----------
async function processSSCCCSV(
  csvText: string,
  companyId: string,
  codeType: CodeType,
): Promise<SSCCLabel[]> {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const allLabels: SSCCLabel[] = [];

  for (const row of parsed.data) {
    const sku = (row['SKU Code'] || row['sku_code'] || row['SKU'] || '').toString().trim();
    const batch = (row['Batch Number'] || row['batch_number'] || row['BATCH'] || '').toString().trim();
    const expRaw = (row['Expiry Date'] || row['expiry_date'] || row['EXP'] || '').toString().trim();
    const unitsPerBox = parseInt(row['Units per Box'] || row['units_per_box'] || '1', 10);
    const boxesPerCarton = parseInt(row['Boxes per Carton'] || row['boxes_per_carton'] || '1', 10);
    const cartonsPerPallet = parseInt(row['Cartons per Pallet'] || row['cartons_per_pallet'] || '1', 10);
    const numberOfPallets = parseInt(row['Number of Pallets'] || row['number_of_pallets'] || '1', 10);
    const hierarchyType = (row['Hierarchy Type'] || row['hierarchy_type'] || 'PALLET').toString().toUpperCase() as GenerationLevel;

    const expISO = normalizeCsvDate(expRaw);
    if (!expISO) {
      throw new Error(`Row ${parsed.data.indexOf(row) + 2}: Expiry Date must be YYYY-MM-DD`);
    }

    if (!sku) continue;

    // Use unified SSCC generation endpoint for CSV too (driven by Hierarchy Type)
    const generate_box = hierarchyType === 'BOX' || hierarchyType === 'CARTON' || hierarchyType === 'PALLET';
    const generate_carton = hierarchyType === 'CARTON' || hierarchyType === 'PALLET';
    const generate_pallet = hierarchyType === 'PALLET';

    const res = await fetch('/api/sscc/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compliance_ack: true,
        sku_id: sku,
        company_id: companyId,
        batch,
        expiry_date: expISO,
        units_per_box: unitsPerBox,
        boxes_per_carton: boxesPerCarton,
        cartons_per_pallet: cartonsPerPallet,
        number_of_pallets: numberOfPallets,
        generate_box,
        generate_carton,
        generate_pallet,
      }),
    });

    const out = await res.json();
    if (out.error) {
      throw new Error(`Failed to generate SSCC for SKU ${sku}: ${out.error}`);
    }

    const allItems: any[] = [
      ...(out.boxes || []).map((item: any) => ({ ...item, level: 'BOX' as GenerationLevel })),
      ...(out.cartons || []).map((item: any) => ({ ...item, level: 'CARTON' as GenerationLevel })),
      ...(out.pallets || []).map((item: any) => ({ ...item, level: 'PALLET' as GenerationLevel }))
    ];

    const labels: SSCCLabel[] = allItems.map((item: any) => ({
      id: item.id,
      sscc: item.sscc,
      sscc_with_ai: item.sscc_with_ai || `(00)${item.sscc}`,
      sku_id: item.sku_id,
      pallet_id: item.pallet_id || item.id,
      level: item.level
    }));

    allLabels.push(...labels);
  }

  return allLabels;
}

// ---------- Export Functions ----------
function exportSSCCCodesCSV(labels: SSCCLabel[]): void {
  const rows = labels.map((label, idx) => ({
    'Row Number': idx + 1,
    'SSCC': label.sscc,
    'SSCC with AI': label.sscc_with_ai,
    'SKU ID': label.sku_id,
    'Level': label.level,
    'Pallet ID': label.pallet_id
  }));

  const csv = Papa.unparse(rows, { header: true });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const filename = `SSCC_CODE_GENERATION_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
  saveAs(blob, filename);
}

// ---------- Main Component ----------
export default function SSCCCodeGenerationPage() {
  const { subscription, isFeatureEnabled, loading: subscriptionLoading } = useSubscription();
  const canGenerate = isFeatureEnabled('code_generation');
  
  const [form, setForm] = useState<SSCCFormState>({
    skuId: '',
    batch: '',
    expiryDate: '',
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

  const [ssccLabels, setSsccLabels] = useState<SSCCLabel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvValidation, setCsvValidation] = useState<{ valid: boolean; errors: CSVValidationError[] } | null>(null);
  const [csvProcessing, setCsvProcessing] = useState(false);
  const [skus, setSkus] = useState<Array<{ id: string; sku_code: string; sku_name: string | null; gtin?: string | null }>>([]);
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
        if (data) {
          setCompanyId(data.id);
          setCompanyName(data.company_name || '');
        }
        if (data?.profile_completed !== undefined) {
          setProfileCompleted(data.profile_completed);
        }

        // Fetch SKUs
        const skuRes = await fetch('/api/skus', { cache: 'no-store' });
        const skuData = await skuRes.json();
        if (skuData?.skus) {
          setSkus(skuData.skus);
          if (skuData.skus.length > 0) {
            setForm(prev => ({ ...prev, skuId: skuData.skus[0].id }));
          }
        }
      }
    })();
  }, []);

  const isGs1Eligible = skus.some((s) => typeof s.gtin === 'string' && s.gtin.trim().length > 0);

  function update<K extends keyof SSCCFormState>(k: K, v: SSCCFormState[K]) {
    setForm(s => {
      const newState = { ...s, [k]: v };
      
      // Enforce hierarchy: Box → Carton → Pallet
      if (k === 'generateBox') {
        // Unselecting Box unselects Carton and Pallet
        if (!v) {
          newState.generateCarton = false;
          newState.generatePallet = false;
        }
      } else if (k === 'generateCarton') {
        // Selecting Carton auto-selects Box
        if (v) {
          newState.generateBox = true;
        } else {
          // Unselecting Carton unselects Pallet
          newState.generatePallet = false;
        }
      } else if (k === 'generatePallet') {
        // Selecting Pallet auto-selects Box and Carton
        if (v) {
          newState.generateBox = true;
          newState.generateCarton = true;
        }
      }
      
      return newState;
    });
  }

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

  async function handleGenerateSingle() {
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (!canGenerate) {
      setError('Code generation is disabled. This feature is available only during an active trial in pilot mode.');
      setLoading(false);
      return;
    }

    if (!isGs1Eligible) {
      setError('SSCC generation is enabled only for GS1-mode companies. Add a GTIN to at least one SKU first.');
      setLoading(false);
      return;
    }

    if (!form.complianceAck) {
      setError('You must confirm compliance to generate SSCC codes.');
      setLoading(false);
      return;
    }

    if (!form.skuId || !form.batch || !form.expiryDate) {
      setError('SKU, Batch Number, and Expiry Date are required');
      setLoading(false);
      return;
    }

    // Validate hierarchy: at least one level must be selected
    if (!form.generateBox && !form.generateCarton && !form.generatePallet) {
      setError('Please select at least one SSCC level (Box, Carton, or Pallet)');
      setLoading(false);
      return;
    }
    if (singleRequestedCodes > MAX_CODES_PER_ROW) {
      setError(`Per entry limit exceeded. Maximum ${MAX_CODES_PER_ROW.toLocaleString()} codes per entry.`);
      setLoading(false);
      return;
    }
    if (singleRequestedCodes > MAX_CODES_PER_REQUEST) {
      setError(`Per request limit exceeded. Maximum ${MAX_CODES_PER_REQUEST.toLocaleString()} codes per request.`);
      setLoading(false);
      return;
    }

    // Validate hierarchy rules
    if (form.generateCarton && !form.generateBox) {
      setError('SSCC generation must follow hierarchy: Box → Carton → Pallet. Carton requires Box.');
      setLoading(false);
      return;
    }
    if (form.generatePallet && (!form.generateBox || !form.generateCarton)) {
      setError('SSCC generation must follow hierarchy: Box → Carton → Pallet. Pallet requires Box and Carton.');
      setLoading(false);
      return;
    }

    try {
      // Use unified SSCC generation endpoint
      const res = await fetch('/api/sscc/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compliance_ack: true,
          sku_id: form.skuId,
          company_id: companyId,
          batch: form.batch,
          expiry_date: form.expiryDate,
          units_per_box: form.unitsPerBox,
          boxes_per_carton: form.boxesPerCarton,
          cartons_per_pallet: form.cartonsPerPallet,
          number_of_pallets: form.numberOfPallets,
          generate_box: form.generateBox,
          generate_carton: form.generateCarton,
          generate_pallet: form.generatePallet
        })
      });

      const out = await res.json();
      if (out.error) {
        throw new Error(out.error);
      }

      // Handle unified response with all levels
      const allItems: any[] = [
        ...(out.boxes || []).map((item: any) => ({ ...item, level: 'BOX' as GenerationLevel })),
        ...(out.cartons || []).map((item: any) => ({ ...item, level: 'CARTON' as GenerationLevel })),
        ...(out.pallets || []).map((item: any) => ({ ...item, level: 'PALLET' as GenerationLevel }))
      ];

      const labels: SSCCLabel[] = allItems.map((item: any) => ({
        id: item.id,
        sscc: item.sscc,
        sscc_with_ai: item.sscc_with_ai || `(00)${item.sscc}`,
        sku_id: item.sku_id,
        pallet_id: item.pallet_id || item.id,
        level: item.level
      }));

      setSsccLabels(prev => [...prev, ...labels]);
      const totalCount = labels.length;
      const levelBreakdown = [
        form.generateBox && `${out.boxes?.length || 0} Box`,
        form.generateCarton && `${out.cartons?.length || 0} Carton`,
        form.generatePallet && `${out.pallets?.length || 0} Pallet`
      ].filter(Boolean).join(', ');
      setSuccess(`Generated ${totalCount} SSCC label(s) successfully (${levelBreakdown})`);
    } catch (e: any) {
      setError(e?.message || 'Unable to generate SSCC codes right now. Please try again.');
    } finally {
      setLoading(false);
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
    if (!isGs1Eligible) {
      setError('SSCC generation is enabled only for GS1-mode companies. Add a GTIN to at least one SKU first.');
      return;
    }
    if (!form.complianceAck) {
      setError('You must confirm compliance to generate SSCC codes.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      
      // Validate CSV
      const validation = validateSSCCCSV(parsed.data, companyId);
      setCsvValidation(validation);

      if (!validation.valid) {
        setError(`CSV validation failed. Please fix ${validation.errors.length} error(s) before generating codes.`);
        return;
      }

      // Process CSV
      setCsvProcessing(true);
      const labels = await processSSCCCSV(text, companyId, form.codeType);
      setSsccLabels(prev => [...prev, ...labels]);
      setSuccess(`Processed CSV: Generated ${labels.length} SSCC code(s)`);
    } catch (e: any) {
      setError(e?.message || 'Unable to process CSV right now. Please try again.');
    } finally {
      setCsvProcessing(false);
    }
  }

  function ssccToLabelData(): LabelData[] {
    return ssccLabels.map(label => ({
      id: label.id,
      payload: label.sscc_with_ai,
      codeType: form.codeType,
      displayText: `SSCC: ${label.sscc} | Level: ${label.level} | SKU: ${label.sku_id}`,
      metadata: { sscc: label.sscc, sku_id: label.sku_id, pallet_id: label.pallet_id, level: label.level }
    }));
  }

  async function handleExport(format: 'PDF' | 'PNG' | 'ZPL' | 'EPL' | 'ZIP' | 'PRINT') {
    if (ssccLabels.length === 0) {
      setError('No labels to export');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const labels = ssccToLabelData();
      const filename = `sscc_labels_${Date.now()}`;
      await exportLabelsUtil(labels, format as any, filename);
      setSuccess(`Exported ${ssccLabels.length} labels as ${format}`);
    } catch (err) {
      setError(`Failed to export ${format}: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint() {
    if (ssccLabels.length === 0) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      let printFormat: 'PDF' | 'EPL' | 'ZPL' = 'PDF';
      const formatChoice = prompt('Select print format:\n1. PDF (Opens OS print dialog)\n2. EPL (Download file)\n3. ZPL (Download file)\n\nEnter 1, 2, or 3:');
      if (formatChoice === '2') printFormat = 'EPL';
      else if (formatChoice === '3') printFormat = 'ZPL';
      else printFormat = 'PDF';

      const labels = ssccToLabelData();
      const filename = `sscc_labels_${Date.now()}`;
      if (printFormat === 'PDF') {
        await exportLabelsUtil(labels, 'PRINT' as any, filename);
      } else {
        await exportLabelsUtil(labels, printFormat as any, filename);
      }
      setSuccess(`Printed ${ssccLabels.length} labels as ${printFormat}`);
    } catch (err) {
      setError(`Failed to print: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  // Block code generation if profile is not completed
  if (profileCompleted === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">SSCC / Logistics Code Generation</h1>
          <p className="text-sm text-gray-600">Generate logistics codes using hierarchy: Unit → Box → Carton → Pallet (SSCC)</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Company Setup Required:</strong> Please complete your company setup before generating codes. 
            <a href="/dashboard/company-setup" className="ml-2 underline font-medium">Go to Company Setup →</a>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">SSCC / Logistics Code Generation</h1>
        <p className="text-sm text-gray-600">Generate logistics codes using hierarchy: Unit → Box → Carton → Pallet (SSCC)</p>
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

      {/* Important Disclaimer */}
      <Alert className="bg-amber-50 border-amber-200">
        <Info className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          <strong>SSCC is for logistics units only.</strong> This workflow generates codes for boxes, cartons, and pallets using hierarchical relationships. Unit-level codes must be generated separately.
        </AlertDescription>
      </Alert>

      {!isGs1Eligible && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>SSCC disabled:</strong> Your company is not GS1-eligible yet. Add a GTIN to at least one SKU to enable SSCC generation.
          </AlertDescription>
        </Alert>
      )}

      <Alert className="bg-slate-50 border-slate-200">
        <AlertDescription className="text-slate-800">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.complianceAck}
              onChange={(e) => update('complianceAck', e.target.checked)}
              className="mt-1"
            />
            <span>
              I confirm I understand and accept the compliance responsibility for generated SSCC codes (format validated only).
            </span>
          </label>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* Single Generation Form */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Single SSCC Generation</CardTitle>
              <CardDescription>Generate SSCC codes one at a time</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="sku">SKU Code *</Label>
                  <Select value={form.skuId} onValueChange={(v) => update('skuId', v)}>
                    <SelectTrigger id="sku">
                      <SelectValue placeholder="Select SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {skus.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
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
                  <Label htmlFor="codeType">Code Format</Label>
                  <Select value={form.codeType} onValueChange={(v) => update('codeType', v as CodeType)}>
                    <SelectTrigger id="codeType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QR">GS1 QR Code</SelectItem>
                      <SelectItem value="DATAMATRIX">GS1 DataMatrix</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* SSCC Level Selection (Hierarchical) */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">SSCC Level Selection *</h4>
                <p className="text-xs text-gray-600 mb-3">
                  Higher logistic levels automatically include lower levels. SSCC generation must follow hierarchy: Box → Carton → Pallet.
                </p>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generateBox}
                      onChange={(e) => update('generateBox', e.target.checked)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 font-medium">Box</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generateCarton}
                      onChange={(e) => update('generateCarton', e.target.checked)}
                      disabled={!form.generateBox}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-sm text-gray-700 font-medium">
                      Carton {!form.generateBox && <span className="text-gray-400">(requires Box)</span>}
                    </span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.generatePallet}
                      onChange={(e) => update('generatePallet', e.target.checked)}
                      disabled={!form.generateBox || !form.generateCarton}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-sm text-gray-700 font-medium">
                      Pallet {(!form.generateBox || !form.generateCarton) && <span className="text-gray-400">(requires Box + Carton)</span>}
                    </span>
                  </label>
                </div>
                {!form.generateBox && !form.generateCarton && !form.generatePallet && (
                  <p className="text-xs text-red-600 mt-2">Please select at least one SSCC level</p>
                )}
              </div>

              {/* Hierarchy Configuration */}
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
                      onChange={(e) => update('unitsPerBox', parseInt(e.target.value) || 1)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="boxesPerCarton">Boxes per Carton *</Label>
                    <Input
                      id="boxesPerCarton"
                      type="number"
                      min="1"
                      value={form.boxesPerCarton}
                      onChange={(e) => update('boxesPerCarton', parseInt(e.target.value) || 1)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="cartonsPerPallet">Cartons per Pallet *</Label>
                    <Input
                      id="cartonsPerPallet"
                      type="number"
                      min="1"
                      value={form.cartonsPerPallet}
                      onChange={(e) => update('cartonsPerPallet', parseInt(e.target.value) || 1)}
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
                      onChange={(e) => update('numberOfPallets', parseInt(e.target.value) || 1)}
                    />
                    <p className={`text-xs mt-1 ${singleLimitError ? 'text-red-600' : 'text-gray-600'}`}>
                      Estimated codes: {singleRequestedCodes.toLocaleString()}.
                      Limits: {MAX_CODES_PER_ROW.toLocaleString()} per entry, {MAX_CODES_PER_REQUEST.toLocaleString()} per request.
                    </p>
                  </div>
                </div>
              </div>

              <Button 
                onClick={handleGenerateSingle} 
                disabled={loading || !canGenerate || !!singleLimitError || !isGs1Eligible || !form.complianceAck}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {loading ? 'Generating...' : 'Generate SSCC Codes'}
              </Button>
            </CardContent>
          </Card>

          {/* CSV Bulk Generation */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Bulk SSCC Generation (CSV)</CardTitle>
              <CardDescription>Upload CSV file for bulk SSCC code generation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* CSV Template Download */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">Download SSCC CSV Template</h4>
                    <p className="text-xs text-gray-600">
                      Use this template to prepare your SSCC generation data with hierarchy information
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => downloadSSCCCSVTemplate(companyName, companyId)}
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
                  <p><strong>Required:</strong> SKU Code, Batch Number, Expiry Date, Units per Box, Boxes per Carton, Cartons per Pallet, Number of Pallets</p>
                  <p><strong>Auto-filled:</strong> Company Name, Company ID, Generation Type, Hierarchy Type</p>
                  <p className="text-blue-700 mt-2 font-semibold"><strong>Quantity Rule:</strong> One SSCC is generated per pallet. The &quot;Number of Pallets&quot; column determines how many SSCC codes will be created.</p>
                  <p><strong>Date format:</strong> YYYY-MM-DD (DDMMYYYY/YYMMDD will be normalized).</p>
                  <p className="text-blue-700"><strong>Limits:</strong> Max {MAX_CODES_PER_ROW.toLocaleString()} codes per CSV row and {MAX_CODES_PER_REQUEST.toLocaleString()} total per upload.</p>
                  <p className="text-amber-700 mt-1"><strong>Note:</strong> This CSV is for SSCC generation only. Unit-level codes require a separate CSV template.</p>
                </div>
              </div>

              {/* CSV Upload */}
              <div>
                <Label htmlFor="csv-upload">Upload SSCC CSV File</Label>
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
                    disabled={csvProcessing || !canGenerate || !isGs1Eligible || !form.complianceAck}
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
                  Processing SSCC CSV file...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview & Batch Section */}
        <div className="lg:col-span-1 space-y-6">
          {/* Hierarchy Visualization (Read-only) */}
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
                <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="font-semibold text-purple-900 mb-1">Pallet (SSCC)</div>
                  <div className="text-purple-700">{form.cartonsPerPallet} cartons per pallet</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Generated SSCC Codes */}
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Generated SSCC Codes</CardTitle>
              <CardDescription>{ssccLabels.length} SSCC code(s) generated</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
                {ssccLabels.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <FileText className="w-10 h-10 mx-auto mb-2" />
                    <p className="text-sm">No SSCC codes generated yet</p>
                  </div>
                ) : (
                  ssccLabels.map((label) => (
                    <div key={label.id} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="text-xs font-mono text-gray-600 mb-2 break-all line-clamp-2">{label.sscc_with_ai}</div>
                      <div className="flex justify-center py-2 bg-white rounded overflow-hidden">
                        {form.codeType === 'QR' ? (
                          <QRCodeComponent value={label.sscc_with_ai} size={70} />
                        ) : (
                          <DataMatrixComponent value={label.sscc_with_ai} size={70} />
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-2">
                        SSCC: {label.sscc} | Level: {label.level}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {ssccLabels.length > 0 && (
                <div className="space-y-2 pt-4 border-t">
                  <Button
                    onClick={() => exportSSCCCodesCSV(ssccLabels)}
                    variant="outline"
                    className="w-full border-gray-300"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export SSCC Codes CSV
                  </Button>
                  <Button
                    onClick={() => handleExport('PDF')}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    Export PDF
                  </Button>
                  <Button
                    onClick={() => handleExport('ZIP')}
                    variant="outline"
                    className="w-full border-gray-300"
                  >
                    Export ZIP (PNGs)
                  </Button>
                  <Button
                    onClick={() => handlePrint()}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                  >
                    Print
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
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

'use client';
import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

import GenerateLabel from '@/lib/generateLabel';
import { buildGs1ElementString } from '@/lib/gs1Builder';
import QRCodeComponent from '@/components/custom/QRCodeComponent';
import DataMatrixComponent from '@/components/custom/DataMatrixComponent';
import { supabaseClient } from '@/lib/supabase/client';
import { exportLabels, LabelData } from '@/lib/labelExporter';

// ---------- types ----------
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

type FormState = {
  gtin: string;
  mfdDate?: string;
  expiryDate?: string;
  batch: string;
  mrp: string;
  sku: string;
  sku_name?: string;
  company: string;
  codeType: CodeType;
  quantity: number;
};

type BatchRow = {
  id: string;
  fields: Gs1Fields;
  payload: string;
  codeType: CodeType;
};

const MAX_CODE_QUANTITY = 10000;

// ---------- helpers ----------
function generateGTIN(prefix = '890'): string {
  const remainingDigits = 13 - prefix.length;
  const random = Math.floor(Math.random() * Math.pow(10, remainingDigits))
    .toString()
    .padStart(remainingDigits, '0');
  return `${prefix}${random}`;
}

function isoDateToYYMMDD(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function buildZplForRow(row: BatchRow) {
  const top = '^XA\n';
  const payloadComment = `^FX Payload: ${row.payload}\n`;
  const fieldsLines =
    `^FO50,50^A0N,30,30^FDGTIN: ${row.fields.gtin}^FS\n` +
    `^FO50,90^A0N,30,30^FDMFD: ${row.fields.mfdYYMMDD ?? ''}^FS\n` +
    `^FO50,130^A0N,30,30^FDEXP: ${row.fields.expiryYYMMDD ?? ''}^FS\n` +
    `^FO50,170^A0N,30,30^FDBATCH: ${row.fields.batch ?? ''}^FS\n` +
    `^FO50,210^A0N,30,30^FDMRP: ${row.fields.mrp ?? ''}^FS\n` +
    `^FO50,250^A0N,30,30^FDSKU: ${row.fields.sku ?? ''}^FS\n` +
    `^FO50,290^A0N,30,30^FDCOMPANY: ${row.fields.company ?? ''}^FS\n`;
  const footer = '^XZ\n';
  return top + payloadComment + fieldsLines + footer;
}

function buildEplForRow(row: BatchRow) {
  const lines = [
    'N',
    `A50,50,0,3,1,1,N,"GTIN:${row.fields.gtin}"`,
    `A50,90,0,3,1,1,N,"MFD:${row.fields.mfdYYMMDD ?? ''}"`,
    `A50,130,0,3,1,1,N,"EXP:${row.fields.expiryYYMMDD ?? ''}"`,
    `A50,170,0,3,1,1,N,"BATCH:${row.fields.batch ?? ''}"`,
    `A50,210,0,3,1,1,N,"MRP:${row.fields.mrp ?? ''}"`,
    'P1'
  ];
  return lines.join('\n') + '\n';
}

// ---------- pdf ----------
async function buildPdf(rows: BatchRow[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const qrcodeMod = await import('qrcode');
  const qrcode: any = (qrcodeMod as any).default ?? qrcodeMod;
  const bwipMod = await import('bwip-js');
  const bwipjs: any = (bwipMod as any).default ?? bwipMod;

  const cols = 10;
  const rowsPerPage = 10;
  const perPage = cols * rowsPerPage;

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const gap = 5;

  const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (pageH - margin * 2 - gap * (rowsPerPage - 1)) / rowsPerPage;

  for (let p = 0; p < rows.length; p += perPage) {
    if (p > 0) doc.addPage();
    const pageItems = rows.slice(p, p + perPage);

    for (let idx = 0; idx < pageItems.length; idx++) {
      const item = pageItems[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * (cellW + gap);
      const y = margin + row * (cellH + gap);

      let dataUrl: string | null = null;
      if (item.codeType === 'QR') {
        dataUrl = await qrcode.toDataURL(item.payload, { margin: 1, width: Math.floor(cellW * 2) });
      } else {
        const canvas = document.createElement('canvas');
        const sz = Math.floor(Math.min(cellW, cellH) * 2);
        canvas.width = sz;
        canvas.height = sz;
        await bwipjs.toCanvas(canvas, {
          bcid: 'datamatrix',
          text: item.payload,
          scale: 3,
          includetext: false
        });
        dataUrl = canvas.toDataURL('image/png');
      }

      if (dataUrl) {
        doc.addImage(dataUrl, 'PNG', x, y, cellW, cellH - 10);
      }

      if (item.fields.serial) {
        doc.setFontSize(6);
        doc.text(String(item.fields.serial), x + 2, y + cellH - 2);
      }
    }
  }

  return doc;
}

// ---------- csv ----------
async function csvToRows(csvText: string): Promise<BatchRow[]> {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  const out: BatchRow[] = [];

  for (const row of parsed.data) {
    const gtinRaw = (row['GTIN'] || row['gtin'] || '').toString().trim();
    const gtin = gtinRaw || generateGTIN();
    const mfdRaw = (row['MFD'] || row['mfd'] || '').toString().trim();
    const expRaw = (row['EXP'] || row['exp'] || '').toString().trim();
    const mrp = (row['MRP'] || row['mrp'] || '').toString().trim();
    const batch = (row['BATCH'] || row['batch'] || '').toString().trim();
    const sku = (row['SKU'] || row['sku'] || '').toString().trim();
    const companyName = (row['COMPANY'] || row['company'] || '').toString().trim();
    const qty = Math.max(1, parseInt((row['QTY'] || '1').toString(), 10) || 1);
    const rowCodeType: CodeType =
      ((row['CODE_TYPE'] || '').toString().toUpperCase() === 'DATAMATRIX') ? 'DATAMATRIX' : 'QR';

    const mfdISO = mfdRaw.length === 6 ? `20${mfdRaw.slice(0,2)}-${mfdRaw.slice(2,4)}-${mfdRaw.slice(4,6)}` : mfdRaw;
    const expISO = expRaw.length === 6 ? `20${expRaw.slice(0,2)}-${expRaw.slice(2,4)}-${expRaw.slice(4,6)}` : expRaw;

    // Keep SKU master updated for CSV flow (non-blocking)
    if (sku) {
      try {
        await fetch('/api/skus/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku_code: sku }),
        });
      } catch {
        // ignore
      }
    }

    const res = await fetch('/api/unit/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compliance_ack: true,
        gtin,
        sku_code: sku,
        batch,
        mfd: mfdISO || expISO,
        expiry: expISO,
        quantity: qty,
        mrp: mrp || undefined,
      })
    });

    if (!res.ok) {
      throw new Error(`Failed to generate codes for SKU: ${sku}`);
    }

    const result = await res.json();
    result.items.forEach((item: any) => {
      out.push({
        id: `r${out.length + 1}`,
        fields: {
          gtin,
          mfdYYMMDD: isoDateToYYMMDD(mfdISO),
          expiryYYMMDD: isoDateToYYMMDD(expISO),
          batch: batch || undefined,
          mrp: mrp || undefined,
          sku: sku || undefined,
          company: companyName || undefined,
          serial: item.serial
        },
        payload: item.gs1,
        codeType: rowCodeType
      });
    });
  }

  return out;
}

// ---------- page ----------
export default function Page() {
  const [form, setForm] = useState<FormState>({
    gtin: '1234567890123',
    batch: '',
    mrp: '',
    sku: '',
    sku_name: '',
    company: '',
    codeType: 'QR',
    quantity: 1
  });

  const [payload, setPayload] = useState<string>();
  const [batch, setBatch] = useState<BatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');
  const [savingSku, setSavingSku] = useState(false);
  const [skuSavedMsg, setSkuSavedMsg] = useState<string>('');
  const [csvUploading, setCsvUploading] = useState(false);

  const quantityTooSmall = form.quantity < 1;
  const quantityExceedsLimit = form.quantity > MAX_CODE_QUANTITY;
  const isQuantityValid = !quantityTooSmall && !quantityExceedsLimit;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabaseClient().auth.getUser();
      if (user) {
        const { data } = await supabaseClient()
          .from('companies')
          .select('id, company_name')
          .eq('user_id', user.id)
          .single();
        if (data?.company_name) {
          setCompany(data.company_name);
          setCompanyId(data.id);
          setForm(prev => ({ ...prev, company: data.company_name }));
        }
      }
    })();
  }, []);

  async function handleSaveSku() {
    setError(null);
    setSkuSavedMsg('');
    const sku_code = (form.sku || '').trim();
    const sku_name = (form.sku_name || '').trim();
    if (!sku_code) {
      setError('SKU Code is required to save into SKU Master');
      return;
    }

    setSavingSku(true);
    try {
      const res = await fetch('/api/skus/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_code, sku_name: sku_name || null }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(out?.error || 'Failed to save SKU');
      }
      setSkuSavedMsg('✅ Saved to SKU Master');
    } catch (e: any) {
      setError(e?.message || 'Failed to save SKU');
    } finally {
      setSavingSku(false);
    }
  }

  async function handleCsvFile(file: File) {
    setError(null);
    if (!file) return;
    setCsvUploading(true);
    try {
      const text = await file.text();
      const rows = await csvToRows(text);
      setBatch((prev) => [...prev, ...rows]);
    } catch (e: any) {
      setError(e?.message || 'Failed to process CSV');
    } finally {
      setCsvUploading(false);
    }
  }

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(s => ({ ...s, [k]: v }));
  }

  function handleBuild() {
    try {
      const built = buildGs1ElementString({
        gtin: form.gtin || generateGTIN(),
        mfdYYMMDD: isoDateToYYMMDD(form.mfdDate),
        expiryYYMMDD: isoDateToYYMMDD(form.expiryDate),
        batch: form.batch || undefined,
        mrp: form.mrp || undefined,
        sku: form.sku || undefined,
        company: company || undefined
      });
      setPayload(built);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleAddToBatch() {
    if (!payload) {
      setError('Build payload first before adding to batch');
      return;
    }
    
    setError(null);
    if (!isQuantityValid) {
      setError(
        quantityTooSmall
          ? 'Quantity must be at least 1.'
          : `Maximum ${MAX_CODE_QUANTITY.toLocaleString()} codes per request.`
      );
      return;
    }
    
    // Generate multiple unit labels based on quantity
    const newRows: BatchRow[] = [];
    for (let i = 0; i < form.quantity; i++) {
      const serialNumber = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
      const itemPayload = buildGs1ElementString({
        gtin: form.gtin || generateGTIN(),
        mfdYYMMDD: isoDateToYYMMDD(form.mfdDate),
        expiryYYMMDD: isoDateToYYMMDD(form.expiryDate),
        batch: form.batch || undefined,
        mrp: form.mrp || undefined,
        sku: form.sku || undefined,
        company: company || undefined,
        serial: serialNumber
      });
      
      newRows.push({
        id: `b${batch.length + i + 1}`,
        fields: {
          gtin: form.gtin || generateGTIN(),
          mfdYYMMDD: isoDateToYYMMDD(form.mfdDate),
          expiryYYMMDD: isoDateToYYMMDD(form.expiryDate),
          batch: form.batch || undefined,
          mrp: form.mrp || undefined,
          sku: form.sku || undefined,
          company: company || undefined,
          serial: serialNumber
        },
        payload: itemPayload,
        codeType: form.codeType
      });
    }
    
    setBatch(s => [...s, ...newRows]);
  }

  // Convert batch to LabelData format for export
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
      await exportLabels(labels, format, `unit_labels_${Date.now()}`);
    } catch (e: any) {
      setError(e?.message || `Failed to export ${format}`);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Label Generation</h1>
          <p className="text-slate-600">Generate GS1-compliant QR codes and DataMatrix labels for pharmaceutical products</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form Section */}
          <form className="lg:col-span-2 space-y-6" onSubmit={e => { e.preventDefault(); handleBuild(); }}>
            {/* Product Identification */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">1</span>
                Product Identification
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">GTIN (13 digits)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.gtin}
                      onChange={e => update('gtin', e.target.value)}
                      className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                      placeholder="1234567890123"
                    />
                    <button
                      type="button"
                      onClick={() => update('gtin', generateGTIN())}
                      className="px-4 py-2.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-medium whitespace-nowrap"
                    >
                      Auto Generate
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Batch Number</label>
                  <input
                    type="text"
                    value={form.batch}
                    onChange={e => update('batch', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="LOT123"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">SKU Code</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={e => update('sku', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="SKU001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">SKU Name (optional)</label>
                  <input
                    type="text"
                    value={form.sku_name || ''}
                    onChange={e => update('sku_name', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="Paracetamol 650mg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Company Name</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e => update('company', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="Company Name"
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveSku}
                    disabled={savingSku}
                    className="px-4 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition font-medium disabled:opacity-60"
                  >
                    {savingSku ? 'Saving…' : 'Save SKU to Master'}
                  </button>
                  {skuSavedMsg && <p className="text-sm text-emerald-700 font-medium">{skuSavedMsg}</p>}
                </div>
              </div>
            </div>

            {/* Date & Pricing Information */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold">2</span>
                Date & Pricing Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Manufacturing Date</label>
                  <input
                    type="date"
                    value={form.mfdDate || ''}
                    onChange={e => update('mfdDate', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Expiry Date</label>
                  <input
                    type="date"
                    value={form.expiryDate || ''}
                    onChange={e => update('expiryDate', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">MRP (₹)</label>
                  <input
                    type="text"
                    value={form.mrp}
                    onChange={e => update('mrp', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="100.00"
                  />
                </div>
              </div>
            </div>

            {/* Label Configuration */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center text-sm font-bold">3</span>
                Label Configuration
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Code Type</label>
                    <select
                      value={form.codeType}
                      onChange={e => update('codeType', e.target.value as CodeType)}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white"
                    >
                      <option value="QR">QR Code</option>
                      <option value="DATAMATRIX">DataMatrix</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      value={form.quantity}
                      max={MAX_CODE_QUANTITY}
                      onChange={e => {
                        const raw = parseInt(e.target.value, 10);
                        update('quantity', Number.isNaN(raw) ? 1 : raw);
                      }}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      Maximum {MAX_CODE_QUANTITY.toLocaleString()} QR/DataMatrix codes per request.
                    </p>
                    {quantityExceedsLimit && (
                      <p className="text-xs text-red-600 mt-1">
                        Reduce quantity to {MAX_CODE_QUANTITY.toLocaleString()} or fewer before adding to batch.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium shadow-sm hover:shadow-md"
              >
                Build Payload
              </button>
              <button
                type="button"
                onClick={handleAddToBatch}
                disabled={!isQuantityValid}
                className="flex-1 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium shadow-sm hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Add to Batch
              </button>
            </div>

            {/* CSV Upload */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center text-sm font-bold">4</span>
                CSV Upload
              </h2>
              <p className="text-sm text-slate-600 mb-3">Upload CSV with headers like GTIN,BATCH,MFD,EXP,MRP,SKU,COMPANY,QTY</p>
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCsvFile(f);
                    e.currentTarget.value = '';
                  }}
                  className="block w-full md:flex-1 text-sm"
                />
                <button
                  type="button"
                  disabled={csvUploading}
                  className="px-4 py-2.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition font-medium disabled:opacity-60"
                >
                  {csvUploading ? 'Processing…' : 'Add CSV to Batch'}
                </button>
              </div>
            </div>
          </form>

          {/* Preview & Batch Section */}
          <div className="lg:col-span-1 space-y-6">
            {/* Live Preview */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <h3 className="font-semibold text-slate-900">Live Preview</h3>
              </div>
              {payload ? (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center justify-center overflow-hidden">
                    <GenerateLabel payload={payload} codeType={form.codeType} size={240} filename={`label_${form.gtin || 'unknown'}.png`} showText />
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                  <div className="text-slate-400 mb-2">
                    <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-500">Build a payload to preview your label</p>
                </div>
              )}
            </div>

            {/* Batch Queue */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Batch Queue</h3>
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">{batch.length} items</span>
              </div>

              <div className="space-y-3 max-h-80 overflow-auto mb-4">
                {batch.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-sm">No labels in batch</p>
                  </div>
                ) : (
                  batch.map((b, idx) => (
                    <div key={b.id} className="p-3 border border-slate-200 rounded-lg hover:border-slate-300 transition bg-slate-50">
                      <div className="text-xs font-mono text-slate-600 mb-2 break-all line-clamp-2">{b.payload}</div>
                      <div className="flex justify-center py-2 bg-white rounded overflow-hidden">
                        {b.codeType === 'QR'
                          ? <QRCodeComponent value={b.payload} size={70} />
                          : <DataMatrixComponent value={b.payload} size={70} />}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {batch.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-slate-200">
                  <button 
                    type="button"
                    className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium flex items-center justify-center gap-2"
                    onClick={() => handleExport('PRINT')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Labels
                  </button>
                  <button 
                    type="button"
                    className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium flex items-center justify-center gap-2"
                    onClick={() => handleExport('PDF')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Export PDF
                  </button>
                  <button 
                    type="button"
                    className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium flex items-center justify-center gap-2"
                    onClick={() => handleExport('ZIP')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export ZIP (PNGs)
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      type="button"
                      className="px-4 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition font-medium text-sm"
                      onClick={() => handleExport('ZPL')}
                    >
                      ZPL
                    </button>
                    <button 
                      type="button"
                      className="px-4 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition font-medium text-sm"
                      onClick={() => handleExport('EPL')}
                    >
                      EPL
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

          {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="text-red-800 font-medium">{error}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

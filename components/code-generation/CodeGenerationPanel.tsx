'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle } from 'lucide-react';

type CodeType = 'QR' | 'DATAMATRIX';
type GtinSource = 'customer' | 'internal';

type SKU = {
  id: string;
  sku_code: string;
  sku_name: string | null;
};

type GeneratedItem = {
  serial: string;
  gs1: string;
};

type CodeGenerationPanelProps = {
  companyName: string;
  companyId: string;
  skus: SKU[];
  onCodesGenerated: (items: GeneratedItem[], gtin: string, batch: string, codeType: CodeType) => void;
};

/**
 * CodeGenerationPanel - Generate Codes
 * 
 * This creates GS1 codes in the system.
 * It does NOT print or export codes.
 */
export default function CodeGenerationPanel({
  companyName,
  companyId,
  skus,
  onCodesGenerated,
}: CodeGenerationPanelProps) {
  const [sku, setSku] = useState('');
  const [batch, setBatch] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [codeType, setCodeType] = useState<CodeType>('QR');
  const [gtinSource, setGtinSource] = useState<GtinSource>('customer');
  const [gtin, setGtin] = useState('');
  const [mfdDate, setMfdDate] = useState('');
  const [mrp, setMrp] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function generateInternalGTIN(prefix = '890'): string {
    const remainingDigits = 13 - prefix.length;
    const random = Math.floor(Math.random() * Math.pow(10, remainingDigits))
      .toString()
      .padStart(remainingDigits, '0');
    const base = `${prefix}${random}`.padStart(14, '0').slice(0, 13);
    
    let sum = 0;
    let multiplier = 3;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += parseInt(base[i], 10) * multiplier;
      multiplier = multiplier === 3 ? 1 : 3;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    
    return `${base}${checkDigit}`;
  }

  async function handleGenerate() {
    setError(null);
    setSuccess(null);

    // Validation
    if (!sku || !batch || !expiryDate) {
      setError('SKU Code, Batch Number, and Expiry Date are required');
      return;
    }

    if (quantity < 1) {
      setError('Quantity must be at least 1');
      return;
    }

    let finalGtin: string;
    if (gtinSource === 'customer') {
      if (!gtin || gtin.trim().length === 0) {
        setError('GTIN is required when GTIN Source is "From Company"');
        return;
      }
      
      // Validate GTIN
      const { validateGTIN } = await import('@/lib/gs1/gtin');
      const validation = validateGTIN(gtin);
      if (!validation.valid) {
        setError(validation.error || 'Invalid GTIN. Please verify the number.');
        return;
      }
      finalGtin = validation.normalized!;
    } else {
      finalGtin = generateInternalGTIN();
    }

    setLoading(true);

    try {
      const res = await fetch('/api/unit/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compliance_ack: true,
          gtin: finalGtin,
          sku_code: sku,
          sku_name: skus.find((s) => s.sku_code === sku)?.sku_name ?? null,
          batch,
          mfd: mfdDate || expiryDate, // fallback to avoid invalid payloads; UI should collect MFD explicitly
          expiry: expiryDate,
          quantity,
          mrp: mrp || undefined,
        }),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type');
        let errorMessage = 'Failed to generate codes';
        
        if (contentType?.includes('application/json')) {
          const errorBody = await res.json().catch(() => ({}));
          errorMessage = errorBody.error || errorMessage;
        }
        
        throw new Error(errorMessage);
      }

      const result = await res.json();
      
      if (!result || !Array.isArray(result.items)) {
        throw new Error('Invalid response format');
      }

      // Notify parent of generated codes
      onCodesGenerated(result.items, finalGtin, batch, codeType);
      
      setSuccess(`Generated ${result.items.length} unit code(s) successfully. GTIN: ${finalGtin}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate codes');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-gray-200">
      <CardHeader>
        {/* Section Header with UX Label */}
        <CardTitle className="text-lg font-semibold">Generate Codes</CardTitle>
        <CardDescription>
          This creates GS1 codes in the system. It does not print or export codes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info Box */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Generate</strong> creates codes and saves them. Use <strong>Export</strong> to download files. Use <strong>Print</strong> to send to your printer.
          </p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        )}
        
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-green-800">{success}</span>
          </div>
        )}

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="sku">SKU Code *</Label>
            <Select value={sku} onValueChange={setSku}>
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
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="BATCH123"
            />
          </div>

          <div>
            <Label htmlFor="expiry">Expiry Date *</Label>
            <Input
              id="expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="quantity">Quantity *</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            />
          </div>

          <div>
            <Label htmlFor="codeType">Code Format</Label>
            <Select value={codeType} onValueChange={(v) => setCodeType(v as CodeType)}>
              <SelectTrigger id="codeType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="QR">GS1 QR Code</SelectItem>
                <SelectItem value="DATAMATRIX">GS1 DataMatrix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="gtinSource">GTIN Source</Label>
            <Select value={gtinSource} onValueChange={(v) => setGtinSource(v as GtinSource)}>
              <SelectTrigger id="gtinSource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">From Company (GS1-issued)</SelectItem>
                <SelectItem value="internal">From RxTrace (Internal)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="gtin">
              GTIN {gtinSource === 'customer' ? '(8-14 digits) *' : ''}
            </Label>
            {gtinSource === 'customer' ? (
              <Input
                id="gtin"
                value={gtin}
                onChange={(e) => setGtin(e.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder="1234567890123"
                maxLength={14}
              />
            ) : (
              <Input
                id="gtin"
                value=""
                disabled
                placeholder="Will be auto-generated"
                className="bg-gray-50"
              />
            )}
          </div>

          <div>
            <Label htmlFor="mfd">Manufacturing Date (Optional)</Label>
            <Input
              id="mfd"
              type="date"
              value={mfdDate}
              onChange={(e) => setMfdDate(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="mrp">MRP (Optional)</Label>
            <Input
              id="mrp"
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
              placeholder="100.00"
            />
          </div>
        </div>

        {/* Generate Button - Standalone */}
        <div className="pt-4 border-t">
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading ? 'Generating...' : 'Generate Unit Codes'}
          </Button>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Generates codes only. Does not export or print.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

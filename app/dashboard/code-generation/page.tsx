'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, Boxes, ArrowRight, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSubscriptionSummary } from '@/lib/hooks/useSubscriptionSummary';

export default function CodeGenerationIndexPage() {
  const router = useRouter();
  const { data, loading } = useSubscriptionSummary();
  const blocked = Boolean(data?.decisions?.generation?.blocked);
  const code = data?.decisions?.generation?.code ?? null;
  const canGenerate = !blocked;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-1.5">Code Generation</h1>
        <p className="text-sm text-gray-600">Choose the type of code generation you need</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Unit-Level Generation */}
        <Card className="border-gray-200 hover:shadow-md transition cursor-pointer" onClick={() => router.push('/dashboard/code-generation/unit')}>
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Unit-Level Code Generation</CardTitle>
                <CardDescription>Generate GS1 unit-level codes for saleable packs</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Generate individual unit codes (QR/DataMatrix) for saleable pharmaceutical products.
              </p>
              <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                <li>SKU-based generation</li>
                <li>Batch and expiry tracking</li>
                <li>Bulk CSV upload support</li>
                <li>Unit-level exports</li>
              </ul>
              <Button 
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                disabled={!canGenerate}
              >
                Generate Unit Codes
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* SSCC / Logistics Generation */}
        <Card className="border-gray-200 hover:shadow-md transition cursor-pointer" onClick={() => router.push('/dashboard/code-generation/sscc')}>
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                <Boxes className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-xl">SSCC / Logistics Code Generation</CardTitle>
                <CardDescription>Generate logistics codes using hierarchy</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Generate SSCC codes for boxes, cartons, and pallets using hierarchical relationships.
              </p>
              <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                <li>Hierarchy: Unit → Box → Carton → Pallet</li>
                <li>SSCC generation for logistics</li>
                <li>Bulk CSV upload support</li>
                <li>Hierarchy mapping exports</li>
              </ul>
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 mt-2">
                <strong>Note:</strong> SSCC is for logistics units only. Unit-level codes must be generated separately.
              </div>
              <Button 
                className="w-full mt-4 bg-purple-600 hover:bg-purple-700"
                disabled={!canGenerate}
              >
                Generate SSCC Codes
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              {!canGenerate && !loading && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Generation blocked: {code || 'blocked'}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Important Notice */}
      <Card className="border-gray-200 bg-gray-50">
        <CardContent className="pt-6">
          <p className="text-sm text-gray-700">
            <strong>Important:</strong> Unit-level code generation and SSCC/logistics code generation are completely separate workflows. 
            Each has its own CSV template, validation, and export format. Do not mix unit CSV data with SSCC CSV data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

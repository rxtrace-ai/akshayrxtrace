// app/dashboard/analytics/page.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { BarChart3, CreditCard, Package, TrendingUp, CheckCircle } from 'lucide-react';

export default function Analytics() {
  return (
    <div className="space-y-10">
      {/* Analytics Section */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="h-8 w-8 text-[#0052CC]" />
          <h1 className="text-4xl font-bold text-[#0052CC]">Analytics</h1>
        </div>
        
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="p-8 text-center border-2 hover:border-orange-300 transition-all">
            <Package className="h-8 w-8 text-orange-500 mx-auto mb-3" />
            <h3 className="text-5xl font-bold text-orange-500">1,24,680</h3>
            <p className="text-xl mt-2 text-gray-600">Total Labels Generated</p>
          </Card>
          
          <Card className="p-8 text-center border-2 hover:border-green-300 transition-all">
            <TrendingUp className="h-8 w-8 text-green-600 mx-auto mb-3" />
            <h3 className="text-5xl font-bold text-green-600">8,420</h3>
            <p className="text-xl mt-2 text-gray-600">This Month</p>
          </Card>
          
          <Card className="p-8 text-center border-2 hover:border-blue-300 transition-all">
            <CheckCircle className="h-8 w-8 text-blue-600 mx-auto mb-3" />
            <h3 className="text-5xl font-bold text-blue-600">98.7%</h3>
            <p className="text-xl mt-2 text-gray-600">Scan Success Rate</p>
          </Card>
        </div>
      </div>

      {/* Billing Section */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <CreditCard className="h-8 w-8 text-[#0052CC]" />
          <h1 className="text-4xl font-bold text-[#0052CC]">Pilot Access</h1>
        </div>

        <Card className="p-8 bg-gradient-to-br from-blue-50 to-orange-50 border-2 border-orange-200">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl">Current Plan</CardTitle>
              <Badge className="bg-green-500 text-white text-lg px-4 py-1">Active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-gray-600">Plan Type</p>
                <p className="text-3xl font-bold text-[#0052CC]">FREE Plan</p>
              </div>
              <div className="space-y-2">
                <p className="text-gray-600">Labels Remaining</p>
                <p className="text-3xl font-bold text-orange-500">1,000 / 1,000</p>
              </div>
            </div>

            <div className="border-t pt-4 mt-6">
              <p className="text-gray-700 mb-4">
                <strong>Note:</strong> Paid billing is disabled during pilot. 
                Choose a paid plan to activate code generation quotas.
              </p>
              <Link href="/contact">
                <Button className="bg-orange-500 hover:bg-orange-600 text-white">
                  View All Plans
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-xl font-semibold text-[#0052CC] mb-2">Need More Labels?</h3>
          <p className="text-gray-700 mb-4">
            Contact sales for pilot onboarding and commercial rollout details.
          </p>
          <a href="mailto:sales@rxtrace.com">
            <Button variant="outline" className="border-[#0052CC] text-[#0052CC] hover:bg-[#0052CC] hover:text-white">
              Contact Sales Team
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

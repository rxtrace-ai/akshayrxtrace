// app/admin/layout.tsx - Super Admin Layout
'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LogOut, Building2, Database, BarChart, Tag, FileText } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [adminEmail, setAdminEmail] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabaseClient().auth.getUser();
      if (user) {
        setAdminEmail(user.email || '');
        // Admin role check: Only authenticated users can access
        // For super-admin features, add additional role verification in specific pages
        // In production, check if user has admin role
      } else {
        router.push('/auth/signin?redirect=/admin');
      }
    }
    checkAdmin();
  }, [router]);

  const handleSignOut = async () => {
    await supabaseClient().auth.signOut();
    router.push('/auth/signin?redirect=/admin');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-lime-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-green-100 border-r border-green-200 flex flex-col shadow-lg">
        <Link href="/" className="p-6 border-b bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 transition">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="RxTrace" width={32} height={32} className="bg-white rounded-md p-1" />
            <div>
              <span className="text-xl font-bold text-white block">Super Admin</span>
              <span className="text-xs text-green-100">RxTrace India</span>
            </div>
          </div>
        </Link>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <li>
              <Link href="/admin">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <BarChart className="h-5 w-5" /> Dashboard
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/companies">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <Building2 className="h-5 w-5" /> Companies
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/subscription-plans">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <FileText className="h-5 w-5" /> Subscription Plans
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/add-ons">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <Tag className="h-5 w-5" /> Add-ons
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/discounts">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <Tag className="h-5 w-5" /> Discounts & Coupons
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/billing">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <BarChart className="h-5 w-5" /> Billing
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/dashboard">
                <Button variant="outline" className="w-full justify-start gap-3 mt-4 border-blue-500 text-blue-600 hover:bg-blue-50">
                  <Database className="h-5 w-5" /> User Dashboard →
                </Button>
              </Link>
            </li>
          </ul>
        </nav>

        <div className="p-4 border-t">
          <Card className="p-4 bg-gradient-to-br from-green-50 to-emerald-100">
            <p className="text-xs font-medium text-gray-600">Logged in as:</p>
            <p className="text-sm text-gray-800 truncate font-semibold">{adminEmail}</p>
            <div className="mt-1 text-xs text-emerald-700 font-medium">System Administrator</div>
          </Card>
          <Button onClick={handleSignOut} variant="outline" className="w-full mt-4 gap-2 border-red-300 text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-auto">
        {children}
      </div>
    </div>
  );
}

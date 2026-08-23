'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  LogOut,
  Building2,
  Database,
  BarChart,
  Tag,
  FileText,
  MessageSquare,
  Users,
} from 'lucide-react';
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
      const {
        data: { user },
      } = await supabaseClient().auth.getUser();
      if (user) {
        setAdminEmail(user.email || '');
      } else {
        router.push('/login?redirect=/admin');
      }
    }
    checkAdmin();
  }, [router]);

  const handleSignOut = async () => {
    await supabaseClient().auth.signOut();
    router.push('/login?redirect=/admin');
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-lime-50">
      <div className="flex w-64 flex-col border-r border-green-200 bg-green-100 shadow-lg">
        <Link href="/" className="border-b bg-gradient-to-r from-green-500 to-emerald-600 p-6 transition hover:from-green-600 hover:to-emerald-700">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="RxTrace" width={32} height={32} className="rounded-md bg-white p-1" />
            <div>
              <span className="block text-xl font-bold text-white">Super Admin</span>
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
                  <Tag className="h-5 w-5" /> Discounts
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
              <Link href="/admin/demo-requests">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <Users className="h-5 w-5" /> Demo Requests
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/admin/support-requests">
                <Button variant="ghost" className="w-full justify-start gap-3 hover:bg-green-200">
                  <MessageSquare className="h-5 w-5" /> Support Requests
                </Button>
              </Link>
            </li>
            <li>
              <Link href="/dashboard">
                <Button variant="outline" className="mt-4 w-full justify-start gap-3 border-blue-500 text-blue-600 hover:bg-blue-50">
                  <Database className="h-5 w-5" /> User Dashboard
                </Button>
              </Link>
            </li>
          </ul>
        </nav>

        <div className="border-t p-4">
          <Card className="bg-gradient-to-br from-green-50 to-emerald-100 p-4">
            <p className="text-xs font-medium text-gray-600">Logged in as:</p>
            <p className="truncate text-sm font-semibold text-gray-800">{adminEmail}</p>
            <div className="mt-1 text-xs font-medium text-emerald-700">System Administrator</div>
          </Card>
          <Button onClick={handleSignOut} variant="outline" className="mt-4 w-full gap-2 border-red-300 text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">{children}</div>
    </div>
  );
}

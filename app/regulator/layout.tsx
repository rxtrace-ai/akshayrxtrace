'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Shield, LogOut, Home } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { supabaseClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegulatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userEmail, setUserEmail] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabaseClient().auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      setUserEmail(user.email || '');
    }

    getUser();
  }, [router]);

  const handleSignOut = async () => {
    await supabaseClient().auth.signOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <Link href="/" className="p-6 border-b hover:bg-blue-50 transition">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="RxTrace" width={32} height={32} />
            <div>
              <span className="text-xl font-bold text-[#0052CC] block">Regulator</span>
              <span className="text-xs text-gray-600">RxTrace India</span>
            </div>
          </div>
        </Link>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <li>
              <Link href="/regulator">
                <Button variant="ghost" className="w-full justify-start gap-3">
                  <Home className="h-5 w-5" /> Overview
                </Button>
              </Link>
            </li>
          </ul>
        </nav>

        <div className="p-4 border-t">
          <Card className="p-4 bg-gradient-to-br from-blue-50 to-orange-50">
            <p className="text-sm font-medium">Logged in as:</p>
            <p className="text-sm text-gray-700 truncate">{userEmail}</p>
          </Card>

          <Button onClick={handleSignOut} variant="outline" className="w-full mt-4 gap-2">
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </div>
      </div>

      <div className="flex-1 p-8">{children}</div>
    </div>
  );
}

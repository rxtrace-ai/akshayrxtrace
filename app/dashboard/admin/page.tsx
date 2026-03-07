'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabaseClient } from '@/lib/supabase/client';
import {
  Search,
  RefreshCw,
  Eye,
  AlertCircle,
  Users,
  Activity,
  TrendingUp,
  Database
} from 'lucide-react';

/* ---------------- TYPES ---------------- */

type ScanLog = {
  id: string;
  scanned_at: string;
  raw_scan: string;
  parsed: any;
  metadata: any;
  ip: string;
  scanner_printer_id: string | null;
};

type Company = {
  id: string;
  company_name: string;
  user_id: string;
  created_at: string;
};

/* ---------------- COMPONENT ---------------- */

export default function AdminDashboard() {
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedScan, setSelectedScan] = useState<ScanLog | null>(null);
  const [relatedScans, setRelatedScans] = useState<ScanLog[]>([]);
  const [showOnlyProblematic, setShowOnlyProblematic] = useState(true);
  const [userCompanyId, setUserCompanyId] = useState<string>('');

  const [stats, setStats] = useState({
    totalScans: 0,
    totalCompanies: 0,
    validScans: 0,
    duplicateScans: 0,
    expiredScans: 0,
    invalidScans: 0,
    last24h: 0
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = supabaseClient();

      /* ✅ AUTH USER */
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('No authenticated user');
        return;
      }

      /* ✅ COMPANY FETCH (FIXED – NO .single()) */
      const { data: companyRows, error: companyErr } = await supabase
        .from('companies')
        .select('id, company_name')
        .eq('user_id', user.id);

      if (companyErr) {
        console.error('Company fetch error:', companyErr.message);
        return;
      }

      if (companyRows && companyRows.length > 0) {
        setUserCompanyId(companyRows[0].id);
      }

      /* ✅ SCAN LOGS */
      let query = supabase
        .from('scan_logs')
        .select('*')
        .order('scanned_at', { ascending: false });

      if (showOnlyProblematic) {
        query = query.in('metadata->>status', [
          'DUPLICATE',
          'INVALID',
          'EXPIRED',
          'ERROR'
        ]);
      }

      const { data: logsData } = await query.limit(500);

      /* ✅ COMPANIES LIST */
      const { data: companiesData } = await supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false });

      if (logsData) {
        setScanLogs(logsData);

        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        setStats({
          totalScans: logsData.length,
          totalCompanies: companiesData?.length || 0,
          validScans: logsData.filter(s => s.metadata?.status === 'VALID').length,
          duplicateScans: logsData.filter(s => s.metadata?.status === 'DUPLICATE').length,
          expiredScans: logsData.filter(s => s.metadata?.status === 'EXPIRED').length,
          invalidScans: logsData.filter(s => s.metadata?.status === 'INVALID').length,
          last24h: logsData.filter(s => new Date(s.scanned_at) > yesterday).length
        });
      }

      if (companiesData) {
        setCompanies(companiesData);
      }
    } catch (err) {
      console.error('Admin dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [showOnlyProblematic]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ---------------- DATA FETCH ---------------- */

  /* ---------------- HELPERS ---------------- */

  async function viewRelatedScans(scan: ScanLog) {
    setSelectedScan(scan);
    const serial = scan.parsed?.serialNo;
    if (!serial) return;

    const supabase = supabaseClient();
    const { data } = await supabase
      .from('scan_logs')
      .select('*')
      .eq('parsed->>serialNo', serial)
      .order('scanned_at', { ascending: false });

    setRelatedScans(data || []);
  }

  function getStatusBadge(status: string) {
    const colors: any = {
      VALID: 'bg-green-500 text-white',
      DUPLICATE: 'bg-yellow-500 text-white',
      EXPIRED: 'bg-orange-500 text-white',
      INVALID: 'bg-red-500 text-white',
      ERROR: 'bg-gray-500 text-white'
    };
    return colors[status] || 'bg-gray-500 text-white';
  }

  const filteredLogs = scanLogs.filter(log =>
    (log.parsed?.serialNo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.parsed?.gtin || '').includes(searchTerm) ||
    (log.parsed?.batchNo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.ip || '').includes(searchTerm) ||
    log.raw_scan.includes(searchTerm)
  );

  /* ---------------- UI ---------------- */

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-orange-600">� Handset Management</h1>
        <div className="flex gap-2">
          <Button
            variant={showOnlyProblematic ? 'default' : 'outline'}
            onClick={() => setShowOnlyProblematic(!showOnlyProblematic)}
          >
            <AlertCircle className="w-4 h-4 mr-2" />
            {showOnlyProblematic ? 'Issues Only' : 'Show All'}
          </Button>
          <Button onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 text-sm text-gray-600">
          Legacy handset token management has been removed from this workspace. Active handset administration now depends on the current device-registration backend.
        </CardContent>
      </Card>
    </div>
  );
}

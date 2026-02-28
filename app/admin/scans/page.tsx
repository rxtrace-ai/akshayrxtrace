'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabaseClient } from '@/lib/supabase/client';
import { Search, RefreshCw, AlertCircle, Download, Building2, Filter, BarChart3 } from 'lucide-react';

type ScanLog = {
  id: string;
  scanned_at: string;
  raw_scan: string;
  parsed: any;
  metadata: any;
  ip: string;
  scanner_printer_id: string | null;
  company_id: string | null;
  handset_id: string | null;
};

type Company = {
  id: string;
  company_name: string;
};

type ScanMetrics = {
  total: number;
  valid: number;
  duplicate: number;
  invalid: number;
  expired: number;
  error: number;
};

export default function SystemScans() {
  const [scanLogs, setScanLogs] = useState<ScanLog[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedScan, setSelectedScan] = useState<ScanLog | null>(null);
  const [showOnlyProblematic, setShowOnlyProblematic] = useState(false);
  
  // PART C: Company-wise reporting filters
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'report'>('list');
  const [metrics, setMetrics] = useState<Record<string, ScanMetrics>>({});

  const fetchCompanies = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/companies?page=1&page_size=1000', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed (${response.status})`);
      }
      const payload = await response.json();
      const rows = Array.isArray(payload?.companies) ? payload.companies : [];
      setCompanies(rows.map((row: any) => ({ id: row.id, company_name: row.company_name })));
    } catch (error: any) {
      console.error('Failed to fetch companies:', error);
    }
  }, []);

  const fetchScans = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = supabaseClient();
      let query = supabase
        .from('scan_logs')
        .select('*')
        .order('scanned_at', { ascending: false });
      
      // Apply filters
      if (selectedCompany !== 'all') {
        query = query.eq('company_id', selectedCompany);
      }
      
      if (selectedStatus !== 'all') {
        query = query.eq('metadata->>status', selectedStatus);
      } else if (showOnlyProblematic) {
        query = query.in('metadata->>status', ['DUPLICATE', 'INVALID', 'EXPIRED', 'ERROR']);
      }
      
      if (dateFrom) {
        query = query.gte('scanned_at', dateFrom);
      }
      if (dateTo) {
        query = query.lte('scanned_at', dateTo + 'T23:59:59');
      }
      
      const { data, error } = await query.limit(5000);
      if (error) throw error;
      if (data) {
        setScanLogs(data);
        calculateMetrics(data);
      }
    } catch (error: any) {
      alert('Failed to fetch scans: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [showOnlyProblematic, selectedCompany, selectedStatus, dateFrom, dateTo]);

  const calculateMetrics = (logs: ScanLog[]) => {
    const companyMetrics: Record<string, ScanMetrics> = {};
    
    logs.forEach(log => {
      const companyId = log.company_id || 'unknown';
      if (!companyMetrics[companyId]) {
        companyMetrics[companyId] = { total: 0, valid: 0, duplicate: 0, invalid: 0, expired: 0, error: 0 };
      }
      
      const status = log.metadata?.status || 'UNKNOWN';
      companyMetrics[companyId].total++;
      if (status === 'VALID') companyMetrics[companyId].valid++;
      else if (status === 'DUPLICATE') companyMetrics[companyId].duplicate++;
      else if (status === 'INVALID') companyMetrics[companyId].invalid++;
      else if (status === 'EXPIRED') companyMetrics[companyId].expired++;
      else if (status === 'ERROR') companyMetrics[companyId].error++;
    });
    
    setMetrics(companyMetrics);
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Company', 'Status', 'GTIN', 'Serial', 'Batch', 'IP', 'Raw Scan'];
    const rows = filteredLogs.map(log => {
      const company = companies.find(c => c.id === log.company_id);
      return [
        new Date(log.scanned_at).toISOString(),
        company?.company_name || 'N/A',
        log.metadata?.status || 'UNKNOWN',
        log.parsed?.gtin || '',
        log.parsed?.serialNo || '',
        log.parsed?.batchNo || '',
        log.ip || '',
        log.raw_scan || ''
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan_logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

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

  const filteredLogs = scanLogs.filter(log => {
    const serial = log.parsed?.serialNo || '';
    const gtin = log.parsed?.gtin || '';
    const batch = log.parsed?.batchNo || '';
    const ip = log.ip || '';
    return serial.toLowerCase().includes(searchTerm.toLowerCase()) ||
           gtin.includes(searchTerm) ||
           batch.toLowerCase().includes(searchTerm.toLowerCase()) ||
           ip.includes(searchTerm) ||
           log.raw_scan.includes(searchTerm);
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-orange-600">🔍 Scan Logs & Reporting</h1>
          <p className="text-gray-600 mt-1">Company-wise scan reporting and analysis</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setViewMode(viewMode === 'list' ? 'report' : 'list')}
            variant="outline"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            {viewMode === 'list' ? 'Report View' : 'List View'}
          </Button>
          <Button onClick={exportToCSV} variant="outline" disabled={filteredLogs.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={fetchScans} disabled={loading} className="bg-orange-500 hover:bg-orange-600">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* PART C: Company-wise Reporting Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters & Reporting
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="company">Company</Label>
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger id="company" className="mt-1.5">
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger id="status" className="mt-1.5">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="VALID">Valid</SelectItem>
                  <SelectItem value="DUPLICATE">Duplicate</SelectItem>
                  <SelectItem value="INVALID">Invalid</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="dateFrom">Date From</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="dateTo">Date To</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PART C: Company-wise Metrics Report */}
      {viewMode === 'report' && Object.keys(metrics).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Company-wise Scan Metrics</CardTitle>
            <CardDescription>Aggregated statistics grouped by company</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(metrics).map(([companyId, m]) => {
                const company = companies.find(c => c.id === companyId);
                return (
                  <div key={companyId} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        {company?.company_name || 'Unknown Company'}
                      </h3>
                      <Badge variant="outline">Total: {m.total}</Badge>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-green-50 p-3 rounded">
                        <div className="text-xs text-gray-600">Valid</div>
                        <div className="text-xl font-bold text-green-600">{m.valid}</div>
                      </div>
                      <div className="bg-yellow-50 p-3 rounded">
                        <div className="text-xs text-gray-600">Duplicate</div>
                        <div className="text-xl font-bold text-yellow-600">{m.duplicate}</div>
                      </div>
                      <div className="bg-red-50 p-3 rounded">
                        <div className="text-xs text-gray-600">Invalid</div>
                        <div className="text-xl font-bold text-red-600">{m.invalid}</div>
                      </div>
                      <div className="bg-orange-50 p-3 rounded">
                        <div className="text-xs text-gray-600">Expired</div>
                        <div className="text-xl font-bold text-orange-600">{m.expired}</div>
                      </div>
                      <div className="bg-gray-50 p-3 rounded">
                        <div className="text-xs text-gray-600">Error</div>
                        <div className="text-xl font-bold text-gray-600">{m.error}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by serial, GTIN, batch, company, IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {selectedStatus !== 'all' && <AlertCircle className="w-5 h-5 text-red-500" />}
            Scan Logs ({filteredLogs.length} of {scanLogs.length})
          </CardTitle>
          <CardDescription>
            {selectedCompany !== 'all' && `Filtered by: ${companies.find(c => c.id === selectedCompany)?.company_name || 'Unknown'}`}
            {dateFrom && dateTo && ` • Date Range: ${dateFrom} to ${dateTo}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredLogs.map((log) => {
              const company = companies.find(c => c.id === log.company_id);
              return (
                <div
                  key={log.id}
                  className={`p-4 border rounded-lg hover:border-orange-500 cursor-pointer transition ${
                    selectedScan?.id === log.id ? 'border-orange-500 bg-orange-50' : ''
                  }`}
                  onClick={() => setSelectedScan(log)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-mono font-bold text-sm">
                          {log.parsed?.serialNo || 'No Serial'}
                        </div>
                        {company && (
                          <Badge variant="outline" className="text-xs">
                            {company.company_name}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        GTIN: {log.parsed?.gtin || 'N/A'} • Batch: {log.parsed?.batchNo || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                        <span>{new Date(log.scanned_at).toLocaleString()}</span>
                        {log.ip && <span>• IP: {log.ip}</span>}
                      </div>
                    </div>
                    <Badge className={getStatusBadge(log.metadata?.status)}>
                      {log.metadata?.status || 'UNKNOWN'}
                    </Badge>
                  </div>
                </div>
              );
            })}
            {filteredLogs.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                {searchTerm || selectedCompany !== 'all' || selectedStatus !== 'all' || dateFrom || dateTo
                  ? 'No scans found matching filters' 
                  : 'No scans recorded yet'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scan Details Panel */}
      {selectedScan && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Scan Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Badge className={getStatusBadge(selectedScan.metadata?.status)}>
                  {selectedScan.metadata?.status || 'UNKNOWN'}
                </Badge>
              </div>
              <div>
                <span className="text-gray-500">Serial:</span> <span className="font-mono">{selectedScan.parsed?.serialNo || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">GTIN:</span> <span className="font-mono">{selectedScan.parsed?.gtin || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Batch:</span> <span className="font-mono">{selectedScan.parsed?.batchNo || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Expiry:</span> <span className="font-mono">{selectedScan.parsed?.expiryDate || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Scanned At:</span> <span>{new Date(selectedScan.scanned_at).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500">IP Address:</span> <span>{selectedScan.ip || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Company:</span> <span className="font-mono">
                  {companies.find(c => c.id === selectedScan.company_id)?.company_name || selectedScan.company_id || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Handset ID:</span> <span className="font-mono">{selectedScan.handset_id || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Printer ID:</span> <span className="font-mono">{selectedScan.scanner_printer_id || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-500">Raw Scan Data:</span>
                <div className="p-2 bg-gray-100 rounded text-xs font-mono break-all max-h-32 overflow-y-auto">
                  {selectedScan.raw_scan}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

type SupportRequest = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string;
  category: string;
  priority: string;
  message: string;
  created_at: string;
};

function formatLabel(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || '-';
}

export default function SupportRequestsAdminPage() {
  const [rows, setRows] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchRows() {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/support-requests?limit=200', { cache: 'no-store' });
      const out = await res.json().catch(() => ({}));

      if (!res.ok || !out?.success) {
        setError(out?.error?.message || out?.error || 'Failed to load support requests');
        setLoading(false);
        return;
      }

      setRows(Array.isArray(out.rows) ? out.rows : []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support requests');
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Support Requests</h1>
          <p className="mt-1 text-gray-600">Submitted from the user dashboard Help &amp; Support page.</p>
        </div>
        <Button onClick={fetchRows} disabled={loading} className="bg-orange-500 hover:bg-orange-600">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Requests ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {rows.map((request) => (
              <div key={request.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="font-semibold text-[#0052CC]">{request.company_name || 'No company name'}</div>
                    <div className="text-sm text-gray-800">{request.full_name}</div>
                    <div className="text-sm text-gray-700">{request.email}</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline">{formatLabel(request.category)}</Badge>
                      <Badge variant={request.priority === 'high' ? 'destructive' : 'secondary'}>
                        {formatLabel(request.priority)}
                      </Badge>
                      <Badge variant="secondary">Received</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{new Date(request.created_at).toLocaleString()}</div>
                </div>

                <div className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{request.message}</div>
              </div>
            ))}

            {rows.length === 0 ? (
              <div className="py-10 text-center text-gray-500">No support requests yet.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

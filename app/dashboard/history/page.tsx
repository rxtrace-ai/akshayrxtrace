'use client';

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import Link from "next/link";

type ScanLogItem = {
  id: string;
  scanned_at: string;
  status: string;
  serial: string;
  gtin: string;
  batch: string;
  expiry: string;
  raw_scan: string;
  ip: string;
  handset_id: string | null;
};

type ScanLogResponse = {
  success: boolean;
  items: ScanLogItem[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  error?: string;
};

const STATUS_OPTIONS = ["", "VALID", "DUPLICATE", "EXPIRED", "INVALID", "ERROR"];

function toDateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function History() {
  const [scanLogs, setScanLogs] = useState<ScanLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState(toDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [toDate, setToDate] = useState(toDateInputValue(new Date()));
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const limit = 50;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });
        if (searchTerm.trim()) params.set("q", searchTerm.trim());
        if (status) params.set("status", status);
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);

        const res = await fetch(`/api/user/scan-logs?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({}))) as ScanLogResponse;
        if (!res.ok) {
          throw new Error(String((json as any).error || "Failed to load scan activity."));
        }

        setScanLogs(Array.isArray(json.items) ? json.items : []);
        setTotal(Number(json.total || 0));
        setHasMore(Boolean(json.has_more));
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(String(err?.message || "Failed to load scan activity."));
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [page, limit, searchTerm, status, fromDate, toDate]);

  function getStatusBadge(value: string) {
    const colors: Record<string, string> = {
      VALID: "bg-green-500 text-white",
      DUPLICATE: "bg-yellow-500 text-white",
      EXPIRED: "bg-orange-500 text-white",
      INVALID: "bg-red-500 text-white",
      ERROR: "bg-gray-500 text-white",
      SUCCESS: "bg-green-500 text-white",
      FAILED: "bg-red-500 text-white",
    };
    return colors[value] || "bg-gray-500 text-white";
  }

  const showingFrom = total === 0 ? 0 : (page - 1) * limit + 1;
  const showingTo = Math.min(page * limit, total);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold text-[#0052CC] mb-2">Scan Activity</h1>
          <p className="text-gray-600">View all verification scans</p>
        </div>
        <Link href="/dashboard/generate">
          <Button className="bg-orange-500 hover:bg-orange-600">Generate New Labels</Button>
        </Link>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      ) : null}

      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by serial, GTIN, batch, or raw data..."
              value={searchTerm}
              onChange={(e) => {
                setPage(1);
                setSearchTerm(e.target.value);
              }}
              className="pl-10"
            />
          </div>
          <select
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || "all"} value={option}>
                {option || "All statuses"}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setPage(1);
                setFromDate(e.target.value);
              }}
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => {
                setPage(1);
                setToDate(e.target.value);
              }}
            />
          </div>
        </div>

        {loading ? <div className="py-10 text-gray-600">Loading scan activity...</div> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b">
              <tr>
                <th className="p-4">Status</th>
                <th className="p-4">Serial Number</th>
                <th className="p-4">GTIN</th>
                <th className="p-4">Batch</th>
                <th className="p-4">Expiry</th>
                <th className="p-4">Scanned At</th>
                <th className="p-4">IP Address</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                scanLogs.map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <Badge className={getStatusBadge(log.status)}>{log.status || "UNKNOWN"}</Badge>
                    </td>
                    <td className="p-4 font-mono text-sm">{log.serial || "N/A"}</td>
                    <td className="p-4 font-mono text-sm">{log.gtin || "N/A"}</td>
                    <td className="p-4">{log.batch || "N/A"}</td>
                    <td className="p-4">{log.expiry || "N/A"}</td>
                    <td className="p-4">
                      {new Date(log.scanned_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-4 text-sm text-gray-600">{log.ip || "N/A"}</td>
                  </tr>
                ))}
              {!loading && scanLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-gray-500">
                    No scans recorded for current filters
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <div>
            Showing {showingFrom}-{showingTo} of {total} scans
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </Button>
            <Button variant="outline" disabled={!hasMore || loading} onClick={() => setPage((prev) => prev + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}


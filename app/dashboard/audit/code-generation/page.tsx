"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BatchRow = {
  id: string;
  batch_no: string;
  generation_family: "UNIT" | "SSCC";
  source: string;
  status: "PENDING" | "SUCCESS" | "PARTIAL_FAILED" | "FAILED";
  sku_code_snapshot: string;
  gtin_snapshot: string | null;
  product_batch_snapshot: string | null;
  code_mode: "GS1" | "PIC" | null;
  symbol_type: "QR" | "DATAMATRIX" | null;
  requested_qty: number;
  generated_qty: number;
  failed_qty: number;
  created_at: string;
  meta?: Record<string, unknown>;
};

type BatchListResponse = {
  rows: BatchRow[];
  total: number;
  page: number;
  page_size: number;
};

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString("en-IN");
  } catch {
    return value;
  }
}

export default function CodeGenerationAuditPage() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generationFamily, setGenerationFamily] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [skuCode, setSkuCode] = useState("");
  const [gtin, setGtin] = useState("");
  const [productBatch, setProductBatch] = useState("");
  const pageSize = 25;

  const logsHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (generationFamily) params.set("generation_family", generationFamily);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (skuCode) params.set("sku_code", skuCode);
    if (gtin) params.set("gtin", gtin);
    if (productBatch) params.set("product_batch", productBatch);
    const qs = params.toString();
    return qs ? `/api/audit/code-generation?${qs}` : "/api/audit/code-generation";
  }, [page, pageSize, from, to, generationFamily, status, source, skuCode, gtin, productBatch]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (generationFamily) params.set("generation_family", generationFamily);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (skuCode) params.set("sku_code", skuCode);
    if (gtin) params.set("gtin", gtin);
    if (productBatch) params.set("product_batch", productBatch);
    return `/api/audit/code-generation/export?${params.toString()}`;
  }, [from, to, generationFamily, status, source, skuCode, gtin, productBatch]);

  async function fetchRows() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(logsHref, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setRows([]);
        setTotal(0);
        setError(body?.error || "Failed to load code generation batches");
        return;
      }
      const payload = body as BatchListResponse | null;
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
      setTotal(typeof payload?.total === "number" ? payload.total : 0);
      setExpandedId(null);
    } catch (err: any) {
      setRows([]);
      setTotal(0);
      setError(err?.message || "Failed to load code generation batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Code Generation Log</h1>
          <p className="text-gray-500">Track batch-wise code generation and export full CSV details per batch.</p>
        </div>
        <Link href="/dashboard/audit" className="btn-primary">
          Back to Audit Logs
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label">Family</label>
          <select className="input" value={generationFamily} onChange={(e) => { setGenerationFamily(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="UNIT">Unit</option>
            <option value="SSCC">SSCC</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="SUCCESS">Success</option>
            <option value="PARTIAL_FAILED">Partial Failed</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div>
          <label className="label">Source</label>
          <select className="input" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="MANUAL">Manual</option>
            <option value="CSV">CSV</option>
            <option value="ERP">ERP</option>
            <option value="API">API</option>
          </select>
        </div>
        <div>
          <label className="label">SKU Code</label>
          <input className="input" value={skuCode} onChange={(e) => { setSkuCode(e.target.value); setPage(1); }} placeholder="Search SKU" />
        </div>
        <div>
          <label className="label">GTIN</label>
          <input className="input" value={gtin} onChange={(e) => { setGtin(e.target.value); setPage(1); }} placeholder="Search GTIN" />
        </div>
        <div>
          <label className="label">Product Batch</label>
          <input className="input" value={productBatch} onChange={(e) => { setProductBatch(e.target.value); setPage(1); }} placeholder="Search batch" />
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button type="button" className="btn-primary" onClick={fetchRows} disabled={loading}>
          {loading ? "Loading..." : "Load"}
        </button>
        <a href={exportHref} className="btn-primary">
          Export Summary CSV
        </a>
      </div>

      {error ? <div className="mb-4 text-sm text-red-600">{error}</div> : null}

      <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
        <div>
          Showing {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}-
          {Math.min(page * pageSize, total)} of {total}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 gap-2 p-3 border-b text-xs font-medium text-gray-500">
          <div className="col-span-2">Date</div>
          <div className="col-span-2">Batch No</div>
          <div className="col-span-2">SKU</div>
          <div className="col-span-1">Family</div>
          <div className="col-span-1">Type</div>
          <div className="col-span-2">Qty</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">CSV</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No code generation batches found.</div>
        ) : (
          rows.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <div key={row.id} className="border-b">
                <div className="grid grid-cols-12 gap-2 p-3 text-sm items-start">
                  <div className="col-span-2">{formatDate(row.created_at)}</div>
                  <div className="col-span-2">
                    <button
                      type="button"
                      className="text-left text-blue-600 hover:text-blue-700"
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      {row.batch_no}
                    </button>
                  </div>
                  <div className="col-span-2">
                    <div>{row.sku_code_snapshot}</div>
                    <div className="text-xs text-gray-500">{row.gtin_snapshot || row.product_batch_snapshot || "-"}</div>
                  </div>
                  <div className="col-span-1">{row.generation_family}</div>
                  <div className="col-span-1">
                    <div>{row.code_mode || "-"}</div>
                    <div className="text-xs text-gray-500">{row.symbol_type || "-"}</div>
                  </div>
                  <div className="col-span-2">
                    <div>{row.generated_qty} / {row.requested_qty}</div>
                    <div className="text-xs text-gray-500">Failed: {row.failed_qty}</div>
                  </div>
                  <div className="col-span-1">{row.status}</div>
                  <div className="col-span-1">
                    <a href={`/api/audit/code-generation/export?batch_id=${encodeURIComponent(row.id)}`} className="text-blue-600 hover:text-blue-700">
                      Download
                    </a>
                  </div>
                </div>

                {expanded ? (
                  <div className="bg-gray-50 px-3 pb-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-3 text-xs">
                      <div>
                        <div className="text-gray-500">Source</div>
                        <div className="font-semibold">{row.source}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">GTIN</div>
                        <div className="font-semibold">{row.gtin_snapshot || "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Requested</div>
                        <div className="font-semibold">{row.requested_qty}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Generated</div>
                        <div className="font-semibold text-green-700">{row.generated_qty}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Failed</div>
                        <div className="font-semibold text-red-700">{row.failed_qty}</div>
                      </div>
                    </div>
                    <div className="rounded border bg-white p-3">
                      <div className="text-xs font-medium text-gray-500 mb-2">Metadata</div>
                      <pre className="text-xs whitespace-pre-wrap break-words text-gray-700">
                        {JSON.stringify(row.meta || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

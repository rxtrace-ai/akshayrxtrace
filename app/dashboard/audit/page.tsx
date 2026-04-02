"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function formatIssueContext(issue: any) {
  const parts = [
    issue?.sku_code ? `SKU ${issue.sku_code}` : "",
    issue?.batch ? `Batch ${issue.batch}` : "",
    issue?.gtin ? `GTIN ${issue.gtin}` : "",
    issue?.serial_number ? `Serial ${issue.serial_number}` : "",
    issue?.sscc ? `SSCC ${issue.sscc}` : "",
    issue?.hierarchy_level ? `Level ${issue.hierarchy_level}` : "",
    issue?.parent_sscc ? `Parent ${issue.parent_sscc}` : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

export default function Page() {
  const [logs, setLogs] = useState<any[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<string[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const actionOptions = useMemo(
    () => [
      { value: "", label: "All actions" },
      { value: "reports.usage.export", label: "Usage Report - Export" },
      { value: "reports.trace.export", label: "Traceability Report - Export" },
      { value: "reports.recall.export", label: "Recall Report - Export" },
      { value: "ERP_UNIT_INGEST", label: "ERP Unit Ingestion" },
      { value: "ERP_SSCC_INGEST", label: "ERP SSCC Ingestion" },
    ],
    []
  );

  const actionLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const opt of actionOptions) {
      if (opt.value) map.set(opt.value, opt.label);
    }
    return map;
  }, [actionOptions]);

  const logsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (action) params.set("action", action);
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `/api/audit/logs?${qs}` : "/api/audit/logs";
  }, [from, to, action, status]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("type", "audit");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (action) params.set("action", action);
    if (status) params.set("status", status);
    return `/api/audit/export?${params.toString()}`;
  }, [from, to, action, status]);

  async function fetchLogs() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(logsHref);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLogs([]);
        setError(body?.error || "Failed to load audit logs");
        return;
      }
      setLogs(Array.isArray(body) ? body : []);
      setExpandedLogIds([]);
    } catch (e: any) {
      setLogs([]);
      setError(e?.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpanded(logId: string) {
    setExpandedLogIds((current) =>
      current.includes(logId)
        ? current.filter((id) => id !== logId)
        : [...current, logId]
    );
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-3xl font-semibold mb-4">Audit Logs</h1>
      <p className="text-gray-500 mb-6">View and export your company&apos;s audit trail.</p>
      <div className="mb-6">
        <Link href="/dashboard/audit/code-generation" className="btn-primary">
          Open Code Generation Log
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="label">From</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div>
          <label className="label">To</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Report</label>
          <select
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {actionOptions.map((opt) => (
              <option key={opt.value || "__all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          type="button"
          className="btn-primary"
          onClick={fetchLogs}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load"}
        </button>

        <a href={exportHref} className="btn-primary">
          Export CSV
        </a>
      </div>

      {error ? <div className="mb-4 text-sm text-red-600">{error}</div> : null}

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 gap-2 p-3 border-b text-xs font-medium text-gray-500">
          <div className="col-span-3">Date</div>
          <div className="col-span-2">Actor</div>
          <div className="col-span-4">Action</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-2">Integration</div>
        </div>

        {logs.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No audit logs found.</div>
        ) : (
          logs.map((log) => {
            const issueRows = Array.isArray(log.metadata?.issue_rows) ? log.metadata.issue_rows : [];
            const validation = log.metadata?.validation_result || {};
            const isExpanded = expandedLogIds.includes(log.id);

            return (
              <div key={log.id} className="border-b">
                <div className="grid grid-cols-12 gap-2 p-3 text-sm">
                  <div className="col-span-3 truncate" title={log.created_at}>
                    {log.created_at}
                  </div>
                  <div className="col-span-2 truncate" title={log.actor}>
                    {log.actor || ""}
                  </div>
                  <div className="col-span-4 truncate" title={log.action}>
                    {actionLabelByValue.get(log.action) ? (
                      <span>
                        {actionLabelByValue.get(log.action)}
                        <span className="text-gray-500"> ({log.action})</span>
                      </span>
                    ) : (
                      log.action
                    )}
                  </div>
                  <div className="col-span-1 truncate" title={log.status}>
                    {log.status}
                  </div>
                  <div
                    className="col-span-2 flex items-center justify-between gap-2"
                    title={log.integration_system || ""}
                  >
                    <span className="truncate">{log.integration_system || ""}</span>
                    {issueRows.length > 0 ? (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-blue-600 hover:text-blue-700"
                        onClick={() => toggleExpanded(log.id)}
                      >
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="bg-gray-50 px-3 pb-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-3 text-xs">
                      <div>
                        <div className="text-gray-500">Total</div>
                        <div className="font-semibold">{validation.total ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Imported</div>
                        <div className="font-semibold text-green-700">{validation.imported ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Duplicates</div>
                        <div className="font-semibold text-amber-700">{validation.duplicates ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Invalid</div>
                        <div className="font-semibold text-red-700">{validation.invalid ?? "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Skipped</div>
                        <div className="font-semibold">{validation.skipped ?? "-"}</div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs bg-white border rounded">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-2 text-left">Row</th>
                            <th className="px-2 py-2 text-left">Type</th>
                            <th className="px-2 py-2 text-left">Reason</th>
                            <th className="px-2 py-2 text-left">Code Context</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issueRows.map((issue: any, index: number) => (
                            <tr key={`${log.id}-${index}`} className="border-t align-top">
                              <td className="px-2 py-2">{issue.row ?? "-"}</td>
                              <td className="px-2 py-2 capitalize">{issue.category ?? "-"}</td>
                              <td className="px-2 py-2">{issue.reason ?? "-"}</td>
                              <td className="px-2 py-2">{formatIssueContext(issue) || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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

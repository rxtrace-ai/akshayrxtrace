"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CreditCard, RefreshCw } from "lucide-react";

type Paged<T> = {
  success: boolean;
  rows: T[];
  total: number;
  page: number;
  page_size: number;
  error?: string;
  message?: string;
};

export default function AdminBillingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"webhooks" | "entitlement" | "checkout">("webhooks");

  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState("");

  const [webhooks, setWebhooks] = useState<Paged<any> | null>(null);
  const [ops, setOps] = useState<Paged<any> | null>(null);
  const [checkout, setCheckout] = useState<Paged<any> | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "webhooks") {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/admin/audit/webhook-events?${params.toString()}`, { cache: "no-store" });
        const payload = (await res.json()) as Paged<any>;
        if (!res.ok || !payload.success) throw new Error(payload.message || payload.error || "Failed to load webhooks");
        setWebhooks(payload);
      } else if (activeTab === "entitlement") {
        const params = new URLSearchParams();
        if (companyId.trim()) params.set("company_id", companyId.trim());
        if (q.trim()) params.set("request_id", q.trim());
        const res = await fetch(`/api/admin/audit/entitlement-ops?${params.toString()}`, { cache: "no-store" });
        const payload = (await res.json()) as Paged<any>;
        if (!res.ok || !payload.success)
          throw new Error(payload.message || payload.error || "Failed to load entitlement ops");
        setOps(payload);
      } else {
        const params = new URLSearchParams();
        if (companyId.trim()) params.set("company_id", companyId.trim());
        if (q.trim()) params.set("idempotency_key", q.trim());
        const res = await fetch(`/api/admin/audit/checkout-sessions?${params.toString()}`, { cache: "no-store" });
        const payload = (await res.json()) as Paged<any>;
        if (!res.ok || !payload.success)
          throw new Error(payload.message || payload.error || "Failed to load checkout sessions");
        setCheckout(payload);
      }
    } catch (err: any) {
      console.error("Error fetching audit data:", err);
      setError(err?.message || "Failed to load billing audit");
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    if (activeTab === "webhooks") return webhooks?.rows || [];
    if (activeTab === "entitlement") return ops?.rows || [];
    return checkout?.rows || [];
  }, [activeTab, webhooks, ops, checkout]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Billing Audit</h1>
          <p className="text-gray-600 mt-1">Webhooks, entitlement consumption, and checkout sessions</p>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Billing Events
          </CardTitle>
          <CardDescription>Read-only admin views backed by canonical tables.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-4">
            <Button variant={activeTab === "webhooks" ? "default" : "outline"} onClick={() => setActiveTab("webhooks")}>
              Webhooks
            </Button>
            <Button
              variant={activeTab === "entitlement" ? "default" : "outline"}
              onClick={() => setActiveTab("entitlement")}
            >
              Entitlement Ops
            </Button>
            <Button variant={activeTab === "checkout" ? "default" : "outline"} onClick={() => setActiveTab("checkout")}>
              Checkout Sessions
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Input
              placeholder={
                activeTab === "webhooks"
                  ? "Search event_id / correlation_id"
                  : activeTab === "entitlement"
                    ? "Search request_id"
                    : "Search idempotency_key"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Input
              placeholder="company_id (optional)"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={activeTab === "webhooks"}
            />
            <Button onClick={fetchData} disabled={loading} variant="outline">
              Apply filters
            </Button>
          </div>

          {error ? <div className="text-sm text-red-600 mb-3">{error}</div> : null}

          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500">
                  {activeTab === "webhooks" ? (
                    <>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Event</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Received</th>
                      <th className="py-2 pr-4">Processed</th>
                    </>
                  ) : activeTab === "entitlement" ? (
                    <>
                      <th className="py-2 pr-4">Op</th>
                      <th className="py-2 pr-4">Company</th>
                      <th className="py-2 pr-4">Metric</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Request ID</th>
                      <th className="py-2 pr-4">At</th>
                    </>
                  ) : (
                    <>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Company</th>
                      <th className="py-2 pr-4">Idempotency</th>
                      <th className="py-2 pr-4">Sub ID</th>
                      <th className="py-2 pr-4">Topup Order</th>
                      <th className="py-2 pr-4">Created</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="py-3 text-gray-600" colSpan={activeTab === "webhooks" ? 5 : 6}>
                      No rows.
                    </td>
                  </tr>
                ) : (
                  rows.slice(0, 50).map((row: any) => (
                    <tr key={row.id} className="border-t">
                      {activeTab === "webhooks" ? (
                        <>
                          <td className="py-2 pr-4">
                            <Badge
                              variant={
                                row.processing_status === "processed"
                                  ? "default"
                                  : row.processing_status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {row.processing_status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.event_id}</td>
                          <td className="py-2 pr-4">{row.event_type}</td>
                          <td className="py-2 pr-4">{row.received_at}</td>
                          <td className="py-2 pr-4">{row.processed_at || "—"}</td>
                        </>
                      ) : activeTab === "entitlement" ? (
                        <>
                          <td className="py-2 pr-4">{row.operation}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.company_id}</td>
                          <td className="py-2 pr-4">{row.metric || "—"}</td>
                          <td className="py-2 pr-4">{row.quantity}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.request_id}</td>
                          <td className="py-2 pr-4">{row.created_at}</td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-4">{row.status}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.company_id}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.idempotency_key}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.provider_subscription_id || "—"}</td>
                          <td className="py-2 pr-4 font-mono text-xs">{row.provider_topup_order_id || "—"}</td>
                          <td className="py-2 pr-4">{row.created_at}</td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


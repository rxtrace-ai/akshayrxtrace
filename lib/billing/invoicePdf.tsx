import React from "react";
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

type InvoiceRow = {
  id: string;
  company_id: string;
  invoice_type?: string | null;
  plan: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency?: string | null;
  status: string;
  paid_at?: string | null;
  reference?: string | null;
  base_amount?: number | null;
  addons_amount?: number | null;
  tax_rate?: number | null;
  tax_amount?: number | null;
  has_gst?: boolean | null;
  gst_number?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  discount_amount?: number | null;
  billing_cycle?: string | null;
  created_at?: string | null;
  provider_payment_id?: string | null;
  metadata?: any;
};

type CompanyRow = {
  id: string;
  company_name?: string | null;
  gst_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
};

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `INR ${safe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-IN", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

function classifyInvoice(invoice: InvoiceRow) {
  const invoiceType = String(invoice.invoice_type || "").trim().toLowerCase();
  const addonsSnapshot = invoice?.metadata?.addons_snapshot ?? null;
  const capacityCount = Array.isArray(addonsSnapshot?.capacity_addons) ? addonsSnapshot.capacity_addons.length : 0;
  const codeCount = Array.isArray(addonsSnapshot?.code_addons) ? addonsSnapshot.code_addons.length : 0;

  if (invoiceType === "subscription") {
    return { label: "Subscription Invoice", accent: "#166534", accentBg: "#DCFCE7" };
  }
  if (capacityCount > 0 && codeCount === 0) {
    return { label: "Capacity Add-on Invoice", accent: "#0F766E", accentBg: "#CCFBF1" };
  }
  if (codeCount > 0 && capacityCount === 0) {
    return { label: "Code Top-up Invoice", accent: "#1D4ED8", accentBg: "#DBEAFE" };
  }
  return { label: "Add-on Invoice", accent: "#7C2D12", accentBg: "#FFEDD5" };
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10.5, color: "#0F172A", backgroundColor: "#FFFFFF" },
  topBand: {
    marginBottom: 18,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandTitle: { fontSize: 20, fontWeight: 700, color: "#020617" },
  brandSub: { marginTop: 4, color: "#475569", lineHeight: 1.4 },
  pill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: 700 },
  grid: { flexDirection: "row", marginTop: 14 },
  gridCol: { flex: 1 },
  gridColGap: { width: 12 },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11.5, fontWeight: 700, marginBottom: 8, color: "#0F172A" },
  box: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  infoLabel: { color: "#64748B" },
  infoValue: { color: "#0F172A", maxWidth: "62%", textAlign: "right" },
  amountStrip: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#0F172A",
  },
  amountStripLabel: { color: "#CBD5E1", fontSize: 9.5, textTransform: "uppercase" },
  amountStripValue: { color: "#FFFFFF", fontSize: 20, fontWeight: 700, marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableHeadCell: { fontSize: 9.5, color: "#64748B", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  tableCellPrimary: { color: "#0F172A", maxWidth: "72%" },
  tableCellMuted: { color: "#64748B", fontSize: 9.5, marginTop: 2 },
  tableAmount: { color: "#0F172A", fontWeight: 600 },
  totalRow: { borderTopWidth: 1, borderTopColor: "#E2E8F0", marginTop: 4, paddingTop: 8 },
  footer: { marginTop: 18, color: "#64748B", fontSize: 9.5, lineHeight: 1.5 },
});

function InvoicePdfDoc({ invoice, company }: { invoice: InvoiceRow; company: CompanyRow }) {
  const amount = toNumber(invoice.amount);
  const base =
    invoice.base_amount != null ? toNumber(invoice.base_amount) : toNumber(invoice?.metadata?.totals_snapshot?.subscription_paise, 0) / 100;
  const addons =
    invoice.addons_amount != null ? toNumber(invoice.addons_amount) : toNumber(invoice?.metadata?.totals_snapshot?.addons_paise, 0) / 100;
  const discountAmount =
    invoice.discount_amount != null ? toNumber(invoice.discount_amount) : toNumber(invoice?.metadata?.totals_snapshot?.discount_paise, 0) / 100;
  const taxAmount =
    invoice.tax_amount != null ? toNumber(invoice.tax_amount) : toNumber(invoice?.metadata?.totals_snapshot?.gst_paise, 0) / 100;
  const billingCycle = invoice.billing_cycle ?? invoice?.metadata?.plan_snapshot?.billing_cycle ?? null;
  const paymentId = String(invoice?.provider_payment_id || invoice?.metadata?.razorpay_payment_id || "-");
  const quoteId = String(invoice?.metadata?.quote_id || "-");
  const planSnapshot = invoice?.metadata?.plan_snapshot ?? null;
  const addonsSnapshot = invoice?.metadata?.addons_snapshot ?? null;
  const codeAddons = Array.isArray(addonsSnapshot?.code_addons) ? addonsSnapshot.code_addons : [];
  const capacityAddons = Array.isArray(addonsSnapshot?.capacity_addons) ? addonsSnapshot.capacity_addons : [];
  const invoiceMeta = classifyInvoice(invoice);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBand}>
          <View style={styles.brandRow}>
            <View>
              <Text style={styles.brandTitle}>RxTrace</Text>
              <Text style={styles.brandSub}>Billing invoice for subscription and add-on purchases</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: invoiceMeta.accentBg }]}>
              <Text style={[styles.pillText, { color: invoiceMeta.accent }]}>{invoiceMeta.label}</Text>
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridCol}>
              <Text style={styles.infoLabel}>Reference</Text>
              <Text style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700 }}>{invoice.reference ?? invoice.id}</Text>
              <Text style={{ marginTop: 4, color: "#475569" }}>Created {formatDate(invoice.created_at, true)}</Text>
            </View>
            <View style={styles.gridColGap} />
            <View style={styles.gridCol}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, textTransform: "capitalize" }}>{invoice.status}</Text>
              <Text style={{ marginTop: 4, color: "#475569" }}>
                {invoice.paid_at ? `Paid ${formatDate(invoice.paid_at, true)}` : "Awaiting settlement"}
              </Text>
            </View>
          </View>

          <View style={styles.amountStrip}>
            <Text style={styles.amountStripLabel}>Final Total</Text>
            <Text style={styles.amountStripValue}>{formatINR(amount)}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.gridCol}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Billed To</Text>
              <View style={styles.box}>
                <Text style={{ fontSize: 12, fontWeight: 700 }}>{company.company_name ?? company.id}</Text>
                <Text style={{ marginTop: 8, color: "#475569" }}>{company.address || "Address not provided"}</Text>
                {company.gst_number ? <Text style={{ marginTop: 6 }}>GST: {company.gst_number}</Text> : null}
                {company.contact_email ? <Text style={{ marginTop: 6 }}>Email: {company.contact_email}</Text> : null}
                {company.contact_phone ? <Text style={{ marginTop: 6 }}>Phone: {company.contact_phone}</Text> : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Purchase Details</Text>
              <View style={styles.box}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Product</Text>
                  <Text style={styles.infoValue}>{String(planSnapshot?.name || invoice.plan || "-")}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Billing cycle</Text>
                  <Text style={styles.infoValue}>{billingCycle ? String(billingCycle) : "-"}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Period start</Text>
                  <Text style={styles.infoValue}>{formatDate(invoice.period_start)}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Period end</Text>
                  <Text style={styles.infoValue}>{formatDate(invoice.period_end)}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.gridColGap} />

          <View style={styles.gridCol}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Payment Details</Text>
              <View style={styles.box}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Quote ID</Text>
                  <Text style={styles.infoValue}>{quoteId}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Payment ID</Text>
                  <Text style={styles.infoValue}>{paymentId}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Invoice ID</Text>
                  <Text style={styles.infoValue}>{invoice.id}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Currency</Text>
                  <Text style={styles.infoValue}>{invoice.currency || "INR"}</Text>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Charge Breakdown</Text>
              <View style={styles.box}>
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeadCell}>Description</Text>
                  <Text style={styles.tableHeadCell}>Amount</Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={styles.tableCellPrimary}>Subscription amount</Text>
                  <Text style={styles.tableAmount}>{formatINR(base)}</Text>
                </View>
                <View style={styles.tableRow}>
                  <Text style={styles.tableCellPrimary}>Add-on amount</Text>
                  <Text style={styles.tableAmount}>{formatINR(addons)}</Text>
                </View>
                {discountAmount > 0 ? (
                  <View style={styles.tableRow}>
                    <Text style={styles.tableCellPrimary}>Discount</Text>
                    <Text style={styles.tableAmount}>-{formatINR(discountAmount)}</Text>
                  </View>
                ) : null}
                {taxAmount > 0 ? (
                  <View style={styles.tableRow}>
                    <Text style={styles.tableCellPrimary}>GST</Text>
                    <Text style={styles.tableAmount}>{formatINR(taxAmount)}</Text>
                  </View>
                ) : null}
                <View style={[styles.tableRow, styles.totalRow]}>
                  <Text style={{ fontWeight: 700 }}>Final total</Text>
                  <Text style={{ fontWeight: 700 }}>{formatINR(amount)}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {codeAddons.length || capacityAddons.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Included Add-ons</Text>
            <View style={styles.box}>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeadCell}>Item</Text>
                <Text style={styles.tableHeadCell}>Amount</Text>
              </View>
              {capacityAddons.map((line: any, idx: number) => (
                <View style={styles.tableRow} key={`capacity-${idx}`}>
                  <View style={{ maxWidth: "72%" }}>
                    <Text style={styles.tableCellPrimary}>{String(line?.name || "Capacity add-on")}</Text>
                    <Text style={styles.tableCellMuted}>
                      {String(line?.entitlement_key || "capacity")} | Qty {toNumber(line?.quantity, 0)}
                      {line?.duration_days ? ` | ${toNumber(line?.duration_days, 0)} days` : ""}
                    </Text>
                  </View>
                  <Text style={styles.tableAmount}>{formatINR(toNumber(line?.line_total_paise, 0) / 100)}</Text>
                </View>
              ))}
              {codeAddons.map((line: any, idx: number) => (
                <View style={styles.tableRow} key={`code-${idx}`}>
                  <View style={{ maxWidth: "72%" }}>
                    <Text style={styles.tableCellPrimary}>{String(line?.name || "Code top-up")}</Text>
                    <Text style={styles.tableCellMuted}>
                      {String(line?.entitlement_key || "codes")} | Qty {toNumber(line?.quantity, 0)} |{" "}
                      {toNumber(line?.allocated_quota, 0).toLocaleString("en-IN")} codes
                    </Text>
                  </View>
                  <Text style={styles.tableAmount}>{formatINR(toNumber(line?.line_total_paise, 0) / 100)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text>This document is generated from the RxTrace billing system.</Text>
          <Text>Keep this invoice for accounting, taxation, and payment reconciliation records.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdfBuffer(opts: { invoice: InvoiceRow; company: CompanyRow }): Promise<Buffer> {
  const instance = pdf(<InvoicePdfDoc invoice={opts.invoice} company={opts.company} />);
  const output = await instance.toBuffer();

  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (typeof output === "string") return Buffer.from(output);

  if (output && typeof (output as any).on === "function") {
    const stream = output as any;
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: any) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
        } else if (typeof chunk === "string") {
          chunks.push(Buffer.from(chunk));
        }
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err: any) => reject(err));
    });
  }

  throw new Error("PDF_BUFFER_CONVERSION_FAILED");
}

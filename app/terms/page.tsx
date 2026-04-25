import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const updatedLabel = "April 25, 2026";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Terms of Use</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Commercial terms for using the RxTrace platform</h1>
          <p className="mt-4 text-base leading-7 text-[#D7EAEA]">Last updated: {updatedLabel}</p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="space-y-8 rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Service scope</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              RxTrace is a SaaS platform for product traceability, anti-counterfeit workflows, SKU Master management, code generation, scan verification, ERP ingestion, and related operational reporting. Access to specific features depends on your active subscription, purchased add-ons, and configured entitlements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Customer data responsibility</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              You are responsible for the accuracy and lawful use of your product data, GTINs, PICs, batch values, expiry values, ERP imports, and other content submitted to the platform. RxTrace does not independently certify that your source data is complete, compliant, or legally valid.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Traceability and authentication disclaimer</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              RxTrace helps record, encode, and verify product identifiers, but no software-only workflow can guarantee that every scanned item is authentic, lawful, or free from tampering. Authentication outcomes depend on the accuracy of source records, operational usage, scanner handling, downstream processes, and the integrity of physical labels or packaging.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Acceptable use</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              You must not use RxTrace to violate law, misrepresent product identity, overload the service, bypass security controls, interfere with another customer’s data, or process records you do not have the right to manage. We may suspend access where necessary to protect the service, comply with law, or investigate abuse.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Subscription, payment, and cancellation</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Paid plans and add-ons are billed according to the amounts presented in your checkout flow, invoice, or signed commercial proposal. Taxes such as GST may apply. Subscription renewals, cancellations, refunds, and invoice handling are described in the{" "}
              <Link href="/billing-policy" className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                Billing Policy
              </Link>
              {" "}and{" "}
              <Link href="/cancellation-policy" className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                Refund & Cancellation Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Limitation of liability and termination</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              To the extent permitted by applicable law, RxTrace provides the platform on a commercial best-effort basis and is not responsible for indirect losses, downstream recalls, business interruption, or third-party claims arising from inaccurate source data, operator misuse, or system integrations outside our control. Either party may end use of the service subject to contract terms, outstanding dues, and any retention obligations for billing or traceability records.
            </p>
          </section>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}

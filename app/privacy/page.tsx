import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const supportEmail = "privacy@rxtrace.in";
const updatedLabel = "April 25, 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Privacy Policy</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">How RxTrace handles operational, billing, and traceability data</h1>
          <p className="mt-4 text-base leading-7 text-[#D7EAEA]">Last updated: {updatedLabel}</p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="space-y-8 rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">What we collect</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              RxTrace stores the information needed to operate your account, deliver traceability workflows, and support subscription billing. This can include company profile details, user accounts, SKU Master records, generated unit and SSCC codes, scan logs, handset activations, ERP import files, and billing records.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Traceability and scan data</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              When your team generates or verifies codes, RxTrace may store payloads, timestamps, linked SKU Master references, and operational metadata required to support anti-counterfeit, reconciliation, and audit workflows. Scan and verification records are used to show product history and platform activity within your workspace.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Billing and payment processing</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              RxTrace uses third-party payment processors, including Razorpay, to process subscription charges and one-time add-on purchases. We store billing identifiers, invoice records, plan selections, taxes, and payment status metadata needed to reconcile payments and support your invoices. Full card details are not stored in the RxTrace application database.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Cookies and basic analytics</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              We use essential cookies and similar browser storage for sign-in, session continuity, and basic application security. We may also collect limited diagnostics and usage analytics to improve reliability, detect abuse, and troubleshoot customer issues.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Retention and deletion</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Operational and billing records are retained for as long as reasonably required to deliver the service, support customer obligations, address disputes, meet tax or accounting requirements, and maintain traceability history. Deletion timelines can vary depending on contract terms, legal obligations, and whether the data is part of invoice, audit, or verification records.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Sharing and support</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              We share data only with service providers and subprocessors needed to operate the platform, such as hosting, authentication, email delivery, and payment processing partners. If you need help with privacy questions, contact{" "}
              <a href={`mailto:${supportEmail}`} className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                {supportEmail}
              </a>
              {" "}or visit our{" "}
              <Link href="/contact" className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                Contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}

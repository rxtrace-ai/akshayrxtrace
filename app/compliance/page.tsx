import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const coverageItems = [
  {
    title: "India-focused pharmaceutical workflows",
    text: "Supports QR and barcode-based traceability workflows commonly used for pharmaceutical packaging, product identification, and audit records.",
  },
  {
    title: "GS1-aligned traceability support",
    text: "Supports GTIN, serial, batch, expiry, manufacturing date, and SSCC-based packaging hierarchy in one system.",
  },
  {
    title: "EU FMD and US DSCSA-style serialization workflows",
    text: "Supports data structures and traceability flows that align with regulated serialization programs used in global markets.",
  },
  {
    title: "Audit-ready reporting",
    text: "Keeps generation, packaging, and traceability records clear for internal reviews, customer checks, and compliance documentation.",
  },
];

const payloadCards = [
  { title: "GTIN", text: "Used when your product already has a GTIN for standards-aligned product identification." },
  { title: "Serial", text: "Gives every saleable unit a unique identity to support verification and traceability." },
  { title: "Batch and Expiry", text: "Helps teams track production lots, shelf life, and product movement with more confidence." },
  { title: "SSCC", text: "Supports box, carton, and pallet hierarchy for warehouse and distribution operations." },
];

const guardrails = [
  "Rxtrace supports compliance workflows, but final compliance depends on your implementation and market requirements.",
  "Rxtrace does not verify GTIN ownership, licensing, or lawful use.",
  "The customer is solely responsible for using valid GTINs and legally compliant packaging data.",
  "Rxtrace does not rely on consumer or patient data to support traceability workflows.",
];

export default function CompliancePage() {
  return (
    <main className="bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader current="compliance" />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Compliance Support</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl">
            Clear traceability support for regulated products
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace supports GS1-aligned traceability workflows, packaging hierarchy, and audit-ready records with language your team can actually understand.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Start Trial
            </Link>
            <Link
              href="/#book-demo"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              What Rxtrace helps you cover
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              This page explains the workflows Rxtrace supports. It is designed to help operations, quality, and commercial teams understand the system without heavy legal or technical language.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {coverageItems.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-[#083B3C]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Code Structure</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              How code support works in simple terms
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              If your product already uses GTIN, Rxtrace can use that structure in code generation and traceability workflows. If you do not use GTIN yet, Rxtrace can still support PIC-based identification.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {payloadCards.map((card) => (
              <div key={card.title} className="rounded-2xl border border-[#D7E3E4] bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-[#083B3C]">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="rounded-3xl border border-[#F2D9A1] bg-[#FFF8E8] p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#9A6500]">Important Notice</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {guardrails.map((item) => (
                <div key={item} className="rounded-2xl border border-[#F6E3B9] bg-white/70 p-5 text-sm leading-6 text-[#7A5A11]">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Need compliance-ready traceability with simpler communication?</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              Talk to our team about the markets, packaging levels, and code flows you need to support.
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
          >
            Contact Sales
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

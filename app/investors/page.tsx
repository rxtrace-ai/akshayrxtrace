import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const painPointCards = [
  {
    title: "Revenue Loss",
    text: "Counterfeit and untraceable goods create direct revenue leakage for brands, distributors, and legitimate channel partners.",
  },
  {
    title: "Brand Trust Dilution",
    text: "When fake or uncontrolled products enter the market, customer confidence weakens and long-term brand value erodes.",
  },
  {
    title: "Consumer Safety Risk",
    text: "In pharma, OTC, medical devices, cosmetics, dairy, and food, poor product authenticity can become a public health issue, not just a commercial issue.",
  },
  {
    title: "Supply Chain Opacity",
    text: "Many businesses still lack reliable unit-level visibility across packaging levels, warehouses, dispatch points, and downstream movement.",
  },
  {
    title: "Compliance Pressure",
    text: "Traceability, barcode and QR verification, audit readiness, and documentation expectations are rising across Indian and export-linked supply chains.",
  },
  {
    title: "Operational Fragmentation",
    text: "Companies often rely on disconnected systems for code generation, reporting, ERP exports, and packaging records, making traceability harder to operationalize.",
  },
];

const industries = [
  "Pharma",
  "Dairy",
  "Food and beverages",
  "Consumer health and OTC",
  "Medical devices",
  "Cosmetics",
];

const rxtraceCapabilities = [
  "Every unit authenticated",
  "Every unit traceable",
  "GS1-aligned traceability workflows",
  "Support for non-GS1 and PIC-based workflows",
  "Serialization and packaging hierarchy support",
  "Auditable reporting",
  "ERP ingestion",
  "Software-first deployment for Indian businesses",
];

const marketOpportunityPoints = [
  "India is a large, fast-growing manufacturing and branded-products market where traceability demand is rising across regulated and trust-sensitive industries.",
  "SMEs and mid-sized manufacturers remain underserved because many traditional solutions are priced and delivered for large enterprise procurement cycles.",
  "The commercial need is broad: authenticity, compliance readiness, auditability, product trust, and channel control all drive adoption.",
  "The market gap is clear between low-cost QR tools and enterprise-heavy traceability deployments.",
];

const gapPoints = [
  "Many existing vendors are enterprise-led, implementation-heavy, quotation-based, and expensive to deploy.",
  "For Indian SMEs and mid-market manufacturers, onboarding speed, transparency, and affordability are often as important as feature depth.",
  "Rxtrace is designed to close this gap with transparent monthly pricing, modular add-ons, and practical deployment without enterprise complexity.",
];

const pricingRows = [
  {
    offering: "Rxtrace Starter",
    pricing: "Rs 4,900 / month",
    whatYouGet: "Traceability entry plan with product identity, hierarchy, verification workflows, and operational reporting.",
  },
  {
    offering: "Rxtrace Growth",
    pricing: "Rs 12,900 / month",
    whatYouGet: "Higher capacity for growing operations with stronger team and product throughput support.",
  },
  {
    offering: "Rxtrace Scale",
    pricing: "Rs 29,000 / month",
    whatYouGet: "Larger operational capacity without forcing companies into enterprise-only procurement models.",
  },
];

const competitorRows = [
  {
    category: "QR-first platforms",
    pricingModel: "Usually self-serve, lower entry cost, feature-led around code creation and scan analytics.",
    onboarding: "Fast to start, but less naturally aligned to deep operational traceability.",
    customerPaysFor: "Dynamic QR codes, landing pages, analytics, and engagement workflows.",
    rxtraceValue: "Rxtrace adds traceability operations, verification, hierarchy, auditable reporting, ERP ingestion, and recurring expansion.",
  },
  {
    category: "Anti-counterfeit and connected packaging vendors",
    pricingModel: "Often moves into custom quotation or higher-tier commercial plans as scope expands.",
    onboarding: "Stronger anti-counterfeit depth, but can become heavier and more expensive for mid-market adoption.",
    customerPaysFor: "Secure-code systems, packaging workflows, and implementation scope.",
    rxtraceValue: "Rxtrace offers a lower-friction, more transparent SaaS path for Indian businesses that still need serious traceability capabilities.",
  },
  {
    category: "Enterprise traceability suites and ERP-led systems",
    pricingModel: "Quotation-based, implementation-heavy, and typically tied to larger contracts and integration scope.",
    onboarding: "Slower to deploy and less accessible to SMEs or mid-sized manufacturers.",
    customerPaysFor: "Large-scale implementation, serialization programs, integration effort, reporting, and enterprise change management.",
    rxtraceValue: "Rxtrace gives Indian companies a software-first model with no enterprise-style setup barrier as the default entry path.",
  },
];

const investablePoints = [
  "Rxtrace solves a real and growing problem at the intersection of compliance, trust, product safety, and digitization.",
  "The business can scale across multiple industries, not just one vertical.",
  "The revenue model is recurring by design: subscriptions, add-ons, and code top-ups.",
  "India’s SME and mid-market manufacturing base offers a large underserved segment for software-first adoption.",
  "The platform sits between cheap utility tooling and enterprise-heavy implementations, which is a strong commercial position.",
];

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#062C2D_0%,#0B4F50_58%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Investors</p>
          <h1 className="mt-4 max-w-5xl text-4xl font-semibold tracking-tight md:text-6xl">
            Back the future of trusted supply chains.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace is building India-first trust and traceability infrastructure for industries where counterfeit
            risk, compliance pressure, and product authenticity are becoming economically essential.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="mailto:investors@rxtrace.in?subject=Request%20Investor%20Brief"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Request Investor Brief
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Speak With The Founders
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Industry Pain In India</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Counterfeit is not only a loss problem. It is a trust, safety, and compliance problem.
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              Indian industries such as pharma, dairy, food and beverages, consumer health and OTC, medical devices,
              and cosmetics face a common structural issue: products move through complex supply chains without enough
              trust infrastructure at the unit level.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {industries.map((industry) => (
              <div key={industry} className="rounded-full border border-[#C8D9DA] bg-[#F3F8F8] px-4 py-2 text-sm font-medium text-[#0F5D5E]">
                {industry}
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {painPointCards.map((card) => (
              <div key={card.title} className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-[#083B3C]">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#365456]">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">What Rxtrace Provides</p>
            <h2 className="mt-3 text-3xl font-semibold">A software-first trust and traceability layer</h2>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              Rxtrace gives Indian businesses a practical path to product trust infrastructure without forcing them
              into enterprise-heavy deployment as the default starting point.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {rxtraceCapabilities.map((item) => (
              <div key={item} className="rounded-2xl border border-[#D7E3E4] bg-white p-5 shadow-sm">
                <p className="text-sm leading-6 text-[#365456]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Market Opportunity</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              A large market, growing pressure, and an underserved adoption segment
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {marketOpportunityPoints.map((item) => (
              <div key={item} className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <p className="text-sm leading-7 text-[#365456]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Gap In Current Market</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              A clear opening between enterprise complexity and practical SaaS adoption
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {gapPoints.map((item) => (
              <div key={item} className="rounded-3xl border border-[#D7E3E4] bg-white p-6 shadow-sm">
                <p className="text-sm leading-7 text-[#365456]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Pricing Positioning</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Transparent monthly pricing with room to scale
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              Rxtrace is designed as a transparent SaaS model: monthly subscriptions, add-ons, auditable reporting,
              ERP ingestion, and scalable expansion without enterprise-style setup cost as the default entry barrier.
            </p>
          </div>

          <div className="mt-10 overflow-x-auto rounded-3xl border border-[#D7E3E4] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#083B3C] text-white">
                <tr>
                  <th className="px-6 py-4 font-semibold">Plan</th>
                  <th className="px-6 py-4 font-semibold">Pricing</th>
                  <th className="px-6 py-4 font-semibold">Positioning</th>
                </tr>
              </thead>
              <tbody>
                {pricingRows.map((row, index) => (
                  <tr key={row.offering} className={index % 2 === 0 ? "bg-[#FCFEFE]" : "bg-white"}>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 font-semibold text-[#083B3C]">{row.offering}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.pricing}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.whatYouGet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-10 overflow-x-auto rounded-3xl border border-[#D7E3E4] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#083B3C] text-white">
                <tr>
                  <th className="px-6 py-4 font-semibold">Competitor Category</th>
                  <th className="px-6 py-4 font-semibold">Pricing Model</th>
                  <th className="px-6 py-4 font-semibold">Onboarding and Accessibility</th>
                  <th className="px-6 py-4 font-semibold">What Customer Pays For</th>
                  <th className="px-6 py-4 font-semibold">Where Rxtrace Adds Value</th>
                </tr>
              </thead>
              <tbody>
                {competitorRows.map((row, index) => (
                  <tr key={row.category} className={index % 2 === 0 ? "bg-[#FCFEFE]" : "bg-white"}>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 font-semibold text-[#083B3C]">{row.category}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.pricingModel}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.onboarding}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.customerPaysFor}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.rxtraceValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Why Rxtrace Is Investable</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">
              A recurring software business aligned to a real market problem
            </h2>
            <div className="mt-8 space-y-3">
              {investablePoints.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Investment Case</p>
            <h2 className="mt-3 text-3xl font-semibold">Trust, compliance, and product safety are not temporary themes</h2>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              Rxtrace is positioned where regulation, digitization, brand protection, and product authenticity meet.
              That makes it both a software opportunity and a trust infrastructure opportunity.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              The business can scale across industries, expand within each customer through operational usage, and
              grow on a recurring SaaS foundation rather than one-time project revenue alone.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Back the future of trusted supply chains.</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              If you believe India needs stronger product trust infrastructure across regulated and brand-sensitive
              industries, we would be glad to share the Rxtrace investment story.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="mailto:investors@rxtrace.in?subject=Request%20Investor%20Brief"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Request Investor Brief
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Speak With The Founders
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F8FAFC] py-10">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-xs leading-6 text-[#5C7173]">
            Rxtrace does not make public investment offers on this website. Any investor discussions are private,
            informational, and subject to applicable law.
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

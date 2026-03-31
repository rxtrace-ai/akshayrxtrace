import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const opportunityPoints = [
  "Counterfeit products weaken brand trust, distributor confidence, and revenue integrity.",
  "Traceability is moving from optional tooling to operating infrastructure for regulated and brand-sensitive goods.",
  "Rxtrace combines subscriptions, add-ons, and code top-ups into a recurring and expandable revenue model.",
  "The platform is positioned between simple QR tools and enterprise-heavy traceability deployments.",
];

const economicPoints = [
  "OECD and EUIPO estimated counterfeit and pirated trade represented as much as 2.5% of world trade, or up to USD 464 billion.",
  "WHO says at least 1 in 10 medical products in low- and middle-income countries are substandard or falsified.",
  "Brand protection, channel trust, and product verification are becoming board-level priorities in regulated and brand-sensitive industries.",
];

const comparisonRows = [
  {
    category: "Generic QR Platforms",
    players: "Uniqode, Scanova",
    strength: "Easy QR creation, campaigns, landing pages, and code analytics.",
    gap: "Limited product authenticity, packaging hierarchy, and operational traceability depth.",
    rxtrace: "Rxtrace is built for product identity, verification, and recurring operational traceability.",
  },
  {
    category: "Enterprise Anti-Counterfeit Platforms",
    players: "Scantrust",
    strength: "Strong secure-code positioning and connected packaging workflows.",
    gap: "Typically heavier, more enterprise-led, and commercially harder for mid-market adoption.",
    rxtrace: "Rxtrace aims to be more operationally accessible while preserving serious traceability depth.",
  },
  {
    category: "Broad Supply-Chain Traceability Platforms",
    players: "TrusTrace and similar enterprise systems",
    strength: "Large-scale supply-chain and compliance visibility.",
    gap: "Broader enterprise scope can create slower rollout and more complex adoption.",
    rxtrace: "Rxtrace focuses on product-level authenticity, packaging hierarchy, and practical rollout speed.",
  },
];

const whyRxtrace = [
  "We are building infrastructure for original product trust, not just code generation.",
  "The product monetizes through recurring subscriptions, capacity expansion, and usage growth.",
  "The go-to-market path is simpler than traditional enterprise traceability projects.",
  "The category expands from one industry into broader product-trust use cases over time.",
];

const revenueModel = [
  "Monthly subscription plans",
  "Capacity add-ons for seats, plants, and handsets",
  "Code top-ups linked to operational growth",
  "Custom enterprise deployment for larger accounts",
];

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#062C2D_0%,#0B4F50_58%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Investors</p>
          <h1 className="mt-4 max-w-5xl text-4xl font-semibold tracking-tight md:text-6xl">
            Build the trust layer for physical products
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace is building product traceability and anti-counterfeit infrastructure for brands that need to
            protect revenue, prove authenticity, and create trusted product movement across the supply chain.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Speak With The Founders
            </Link>
            <Link
              href="mailto:investors@rxtrace.in?subject=Investor%20Interest%20in%20Rxtrace"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Request Investor Brief
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Why Now</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">A category moving from compliance to infrastructure</h2>
            <div className="mt-8 space-y-4">
              {opportunityPoints.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-white p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Economic Perspective</p>
            <h2 className="mt-3 text-3xl font-semibold">A large and persistent market problem</h2>
            <div className="mt-8 space-y-4">
              {economicPoints.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-[#D7EAEA]">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-[#F7C35F]/30 bg-[#F7C35F]/10 p-5">
              <p className="text-sm leading-6 text-[#F9E7B1]">
                The opportunity is not only regulatory. It is economic: revenue leakage, market trust, and product verification all become monetizable software problems.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">What We Build</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Product identity, traceability, and operational trust
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {[
              "Assign secure product identity using GTIN or PIC-based workflows.",
              "Track unit, box, carton, and pallet relationships across packaging hierarchy.",
              "Support originality verification and audit-ready operational records.",
              "Expand revenue through subscriptions, add-ons, and code top-ups.",
            ].map((item) => (
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Competitive Position</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Positioned between simple QR tools and heavy enterprise suites
            </h2>
          </div>

          <div className="mt-10 overflow-x-auto rounded-3xl border border-[#D7E3E4] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#083B3C] text-white">
                <tr>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold">Existing Players</th>
                  <th className="px-6 py-4 font-semibold">What They Do Well</th>
                  <th className="px-6 py-4 font-semibold">Gap</th>
                  <th className="px-6 py-4 font-semibold">Why Rxtrace</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, index) => (
                  <tr key={row.category} className={index % 2 === 0 ? "bg-[#FCFEFE]" : "bg-white"}>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 font-semibold text-[#083B3C]">{row.category}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.players}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.strength}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.gap}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.rxtrace}</td>
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Why Rxtrace</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Why we believe this business can win</h2>
            <div className="mt-8 space-y-3">
              {whyRxtrace.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Business Model</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Recurring, expandable, operationally aligned</h2>
            <div className="mt-8 grid gap-4">
              {revenueModel.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl bg-[#083B3C] p-6 text-white">
              <h3 className="text-lg font-semibold">The core investment logic</h3>
              <p className="mt-3 text-sm leading-7 text-[#D7EAEA]">
                Rxtrace is building a business that can expand both by company count and by operational depth inside each company. Every successful deployment opens more capacity, more usage, and more commercial expansion.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Interested in the category we are building?</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              We are building traceability infrastructure for original products in markets where trust, verification, and product authenticity are becoming essential.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="mailto:investors@rxtrace.in?subject=Request%20Investor%20Deck"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Request Investor Deck
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Connect With Founders
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F8FAFC] py-10">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-xs leading-6 text-[#5C7173]">
            Rxtrace does not make public investment offers on this website. Any investor discussions are private, informational, and subject to applicable law.
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

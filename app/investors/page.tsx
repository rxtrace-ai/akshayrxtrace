import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const indiaThesisPoints = [
  "India is a large product economy, but trust infrastructure for physical goods remains uneven across industries.",
  "Counterfeit, illicit, and untracked goods create direct revenue leakage for brands in pharma, FMCG, food, beverages, cosmetics, healthcare, and consumer products.",
  "Regulatory direction is moving toward stronger labeling, identification, traceability, and auditability in critical sectors.",
  "Rxtrace is building India-first product trust infrastructure with a commercial model designed for recurring revenue and operational expansion.",
];

const regulatoryPoints = [
  "In Indian pharma exports, barcode-based track-and-trace workflows have already become part of real operational compliance expectations.",
  "GS1 standards are already central in many Indian retail, logistics, healthcare, and export workflows where interoperability matters.",
  "The opportunity is not to claim one universal mandate across all sectors. It is to build software for a market that is clearly moving toward standardized product identification and traceability.",
];

const economicSignals = [
  "FICCI CASCADE estimated illicit market size across five key Indian industries at Rs 2,60,094 crore for 2019-20.",
  "The same FICCI analysis estimated tax losses of Rs 58,521 crore across those sectors.",
  "The issue is not limited to pharma. It spans packaged foods, personal goods, alcoholic beverages, consumer products, and other trust-sensitive categories.",
];

const marketBreakdown = [
  { industry: "FMCG packaged foods", value: "Rs 1,42,284 crore" },
  { industry: "FMCG household and personal goods", value: "Rs 55,530 crore" },
  { industry: "Alcoholic beverages", value: "Rs 23,466 crore" },
  { industry: "Tobacco", value: "Rs 22,930 crore" },
  { industry: "Mobile phones", value: "Rs 15,884 crore" },
];

const buildPoints = [
  "Assign secure product identity using GTIN or PIC-based workflows.",
  "Manage packaging hierarchy from unit to box, carton, and pallet.",
  "Support originality verification and operational traceability records.",
  "Monetize through subscriptions, capacity add-ons, and code top-ups.",
];

const comparisonRows = [
  {
    category: "Generic QR Platforms",
    players: "Uniqode, Scanova",
    strength: "Easy QR creation, landing pages, and lightweight campaign workflows.",
    economics: "Low-cost and easy to adopt, but less aligned to recurring operational traceability depth.",
    rxtrace: "Rxtrace is built around product identity, packaging hierarchy, verification, and repeatable operational usage.",
  },
  {
    category: "Enterprise Traceability and Anti-Counterfeit Platforms",
    players: "Scantrust and similar enterprise platforms",
    strength: "Strong anti-counterfeit positioning and serious enterprise feature depth.",
    economics: "Higher contract value potential, but often longer sales cycles and heavier rollout requirements.",
    rxtrace: "Rxtrace aims to win with India-first accessibility, simpler adoption, and a cleaner recurring expansion model.",
  },
  {
    category: "Broad Supply-Chain Traceability Platforms",
    players: "TrusTrace and broader enterprise systems",
    strength: "Strong visibility across enterprise compliance and supply-chain workflows.",
    economics: "Broad scope creates value, but can also slow adoption and increase implementation complexity.",
    rxtrace: "Rxtrace stays focused on product trust, authenticity, and traceability that brands can operationalize faster.",
  },
];

const whyRxtrace = [
  "We are solving a direct commercial problem: revenue leakage and trust erosion from fake or uncontrolled products.",
  "The business model expands naturally through more companies, more plants, more users, and more code usage.",
  "The platform sits between cheap QR tooling and enterprise-heavy traceability suites.",
  "India provides a strong entry market with cross-industry demand and global relevance over time.",
];

const businessModel = [
  "Monthly subscription plans",
  "Capacity expansion for seats, plants, and handsets",
  "Code top-ups tied to operational growth",
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
            India needs stronger trust infrastructure for physical products
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace is building product traceability and anti-counterfeit infrastructure for an India-first market
            where counterfeit risk, fragmented supply chains, and regulatory pressure are rising together.
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
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">India-First Thesis</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Why this market matters now</h2>
            <div className="mt-8 space-y-4">
              {indiaThesisPoints.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-white p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Regulatory Direction</p>
            <h2 className="mt-3 text-3xl font-semibold">Standards and traceability are becoming harder to ignore</h2>
            <div className="mt-8 space-y-4">
              {regulatoryPoints.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-[#D7EAEA]">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-[#F7C35F]/30 bg-[#F7C35F]/10 p-5">
              <p className="text-sm leading-6 text-[#F9E7B1]">
                The opportunity is not to overclaim one universal mandate. It is to serve a market where standardized product identity is becoming commercially and operationally essential.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Economic Perspective</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Counterfeit and illicit trade are revenue problems</h2>
            <div className="mt-8 space-y-4">
              {economicSignals.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Illustrative Indian Losses</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">This is not just a pharma issue</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {marketBreakdown.map((item) => (
                <div key={item.industry} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 shadow-sm">
                  <div className="text-sm font-semibold text-[#083B3C]">{item.industry}</div>
                  <p className="mt-2 text-sm leading-6 text-[#5C7173]">{item.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm leading-6 text-[#5C7173]">
              The market pain spans food, beverages, household goods, cosmetics, healthcare, and other trust-sensitive categories where authenticity affects both revenue and reputation.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">What We Build</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Product identity, traceability, and operational trust
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {buildPoints.map((item) => (
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Competitive Position</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Positioned for India-scale adoption with global relevance
            </h2>
          </div>

          <div className="mt-10 overflow-x-auto rounded-3xl border border-[#D7E3E4] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#083B3C] text-white">
                <tr>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold">Existing Players</th>
                  <th className="px-6 py-4 font-semibold">What They Do Well</th>
                  <th className="px-6 py-4 font-semibold">Economic Perspective</th>
                  <th className="px-6 py-4 font-semibold">Why Rxtrace</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, index) => (
                  <tr key={row.category} className={index % 2 === 0 ? "bg-[#FCFEFE]" : "bg-white"}>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 font-semibold text-[#083B3C]">{row.category}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.players}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.strength}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.economics}</td>
                    <td className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">{row.rxtrace}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Why Rxtrace</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Why we believe this business can win</h2>
            <div className="mt-8 space-y-3">
              {whyRxtrace.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-white p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Business Model</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Recurring, expandable, and operationally aligned</h2>
            <div className="mt-8 grid gap-4">
              {businessModel.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl bg-[#083B3C] p-6 text-white">
              <h3 className="text-lg font-semibold">The investment logic</h3>
              <p className="mt-3 text-sm leading-7 text-[#D7EAEA]">
                Rxtrace is building a business that can scale by customer count and by operational depth inside each customer. Every successful deployment creates room for more capacity, more usage, and more recurring expansion.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Interested in an India-first product trust infrastructure story?</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              We are building traceability infrastructure for markets where authenticity, product identity, and trust are becoming economically essential.
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

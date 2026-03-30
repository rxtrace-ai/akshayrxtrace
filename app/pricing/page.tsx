import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const planHighlights = [
  "10-day guided trial activation for INR 1",
  "GTIN or PIC-based product traceability",
  "Unit, box, carton, and pallet hierarchy",
  "Verification history and audit-ready records",
  "Capacity add-ons for seats, plants, and handsets",
  "Commercial plans that scale with rollout volume",
];

const plans = [
  {
    name: "Starter",
    monthly: "INR 9,900",
    yearly: "INR 99,000 / year",
    description: "For pilot teams starting product traceability with a focused rollout.",
    cta: "Start 10-Day Trial",
    href: "/auth/signup",
    featured: false,
    items: [
      "1 plant",
      "3 users",
      "2 handsets",
      "10,000 codes / month",
      "GTIN and PIC workflows",
      "Reports and traceability history",
    ],
  },
  {
    name: "Growth",
    monthly: "INR 24,900",
    yearly: "INR 249,000 / year",
    description: "For growing operations that need more team capacity and higher monthly volume.",
    cta: "Start 10-Day Trial",
    href: "/auth/signup",
    featured: true,
    items: [
      "2 plants",
      "8 users",
      "5 handsets",
      "50,000 codes / month",
      "Everything in Starter",
      "Guided rollout support",
    ],
  },
  {
    name: "Scale",
    monthly: "INR 59,900",
    yearly: "INR 599,000 / year",
    description: "For multi-site operations that need stronger throughput and rollout control.",
    cta: "Talk to Sales",
    href: "/contact",
    featured: false,
    items: [
      "5 plants",
      "20 users",
      "12 handsets",
      "200,000 codes / month",
      "Priority onboarding support",
      "Advanced rollout planning",
    ],
  },
  {
    name: "Enterprise",
    monthly: "Custom",
    yearly: "Custom",
    description: "For large regulated deployments with custom workflows, integrations, and support expectations.",
    cta: "Book a Demo",
    href: "/#book-demo",
    featured: false,
    items: [
      "Custom plants, users, and devices",
      "Custom code volumes",
      "API and ERP integration",
      "Dedicated onboarding",
      "SLA-backed support",
      "Commercial scoping by requirement",
    ],
  },
];

const comparisonRows = [
  ["10-day trial available", "Yes", "Yes", "Sales-led", "Sales-led"],
  ["Trial activation", "INR 1", "INR 1", "Custom", "Custom"],
  ["GTIN workflow support", "Yes", "Yes", "Yes", "Yes"],
  ["PIC workflow support", "Yes", "Yes", "Yes", "Yes"],
  ["Packaging hierarchy", "Yes", "Yes", "Yes", "Yes"],
  ["Plants included", "1", "2", "5", "Custom"],
  ["Users included", "3", "8", "20", "Custom"],
  ["Handsets included", "2", "5", "12", "Custom"],
  ["Included codes / month", "10,000", "50,000", "200,000", "Custom"],
  ["Add-ons supported", "Yes", "Yes", "Yes", "Yes"],
  ["API / ERP integration", "Add-on", "Add-on", "Available", "Included by scope"],
  ["Onboarding support", "Standard", "Guided", "Priority", "Dedicated"],
];

const addOnRows = [
  ["Extra user seat", "INR 1,500 / month"],
  ["Extra plant", "INR 4,500 / month"],
  ["Extra handset", "INR 1,200 / month"],
  ["10,000 extra codes", "INR 2,500 / month"],
  ["50,000 extra codes", "INR 9,000 / month"],
  ["100,000 extra codes", "INR 16,000 / month"],
];

const faqItems = [
  {
    question: "How does the trial work?",
    answer:
      "You sign up, complete company setup, and activate the 10-day trial through an INR 1 Razorpay payment. Trial access starts after payment confirmation.",
  },
  {
    question: "Is the INR 1 trial refundable?",
    answer:
      "The INR 1 payment is used to activate the trial flow. Commercial subscription charges begin only when you choose a paid plan.",
  },
  {
    question: "Does Rxtrace support both GTIN and PIC flows?",
    answer:
      "Yes. Rxtrace supports GTIN-based workflows when you already have GTIN data, and PIC-based identification when GTIN is not in use.",
  },
  {
    question: "Does Rxtrace verify GTIN ownership?",
    answer:
      "No. Rxtrace reads and processes GTIN structure for workflow use, but GTIN ownership and lawful use remain the customer's responsibility.",
  },
];

export default function PricingPage() {
  return (
    <main className="bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader current="pricing" />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Pricing</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl">
            Start with a 10-day trial, then scale with your operations
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace pricing is built for teams that need real product traceability, anti-counterfeit protection,
            and a clean path from pilot to full rollout.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Start 10-Day Trial
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
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#FCFEFE] p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">What You Get</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Built for real traceability operations</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {planHighlights.map((item) => (
                <div key={item} className="rounded-2xl border border-[#E2ECEC] bg-white p-5 text-sm leading-6 text-[#365456] shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Trial First</p>
            <h2 className="mt-3 text-3xl font-semibold">A low-friction evaluation path</h2>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              The best way to evaluate Rxtrace is to onboard your team, test GTIN or PIC code generation, and review traceability flows in your own environment before commercial rollout.
            </p>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm font-semibold text-[#F7C35F]">Trial details</div>
              <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">10-day access window</p>
              <p className="mt-1 text-sm leading-6 text-[#D7EAEA]">INR 1 activation through Razorpay</p>
              <p className="mt-1 text-sm leading-6 text-[#D7EAEA]">Starts after payment confirmation</p>
            </div>
            <Link
              href="/auth/signup"
              className="mt-8 inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Start 10-Day Trial
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Plans</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Clear commercial plans for each stage of rollout
            </h2>
          </div>

          <div className="mt-12 grid gap-6 xl:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-3xl border p-7 shadow-sm ${
                  plan.featured
                    ? "border-[#0F5D5E] bg-[#083B3C] text-white shadow-[0_20px_60px_rgba(8,59,60,0.16)]"
                    : "border-[#D7E3E4] bg-white text-[#0F172A]"
                }`}
              >
                <p className={`text-sm font-semibold uppercase tracking-[0.18em] ${plan.featured ? "text-[#F7C35F]" : "text-[#0F5D5E]"}`}>
                  {plan.name}
                </p>
                <div className="mt-5">
                  <div className="text-3xl font-semibold tracking-tight">{plan.monthly}</div>
                  <p className={`mt-2 text-sm ${plan.featured ? "text-[#D7EAEA]" : "text-[#5C7173]"}`}>{plan.yearly}</p>
                </div>
                <p className={`mt-5 text-sm leading-6 ${plan.featured ? "text-[#D7EAEA]" : "text-[#5C7173]"}`}>{plan.description}</p>
                <div className="mt-6 space-y-3">
                  {plan.items.map((item) => (
                    <div
                      key={item}
                      className={`rounded-2xl px-4 py-3 text-sm ${
                        plan.featured ? "bg-white/8 text-white" : "bg-[#F7FAFA] text-[#365456]"
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
                <Link
                  href={plan.href}
                  className={`mt-7 inline-flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-[#F59E0B] text-[#083B3C] hover:bg-[#F7B733]"
                      : "bg-[#0F5D5E] text-white hover:bg-[#0B4849]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Compare Plans</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              A simple feature-by-feature comparison
            </h2>
          </div>

          <div className="mt-10 overflow-x-auto rounded-3xl border border-[#D7E3E4] bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#083B3C] text-white">
                <tr>
                  <th className="px-6 py-4 font-semibold">Feature</th>
                  <th className="px-6 py-4 font-semibold">Starter</th>
                  <th className="px-6 py-4 font-semibold">Growth</th>
                  <th className="px-6 py-4 font-semibold">Scale</th>
                  <th className="px-6 py-4 font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, index) => (
                  <tr key={row[0]} className={index % 2 === 0 ? "bg-[#FCFEFE]" : "bg-white"}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${row[0]}-${cellIndex}`} className="border-t border-[#E5EFEF] px-6 py-4 text-[#365456]">
                        {cell}
                      </td>
                    ))}
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Add-Ons</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Extend capacity as you grow</h2>
            <div className="mt-8 space-y-3">
              {addOnRows.map(([name, price]) => (
                <div key={name} className="flex items-center justify-between rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] px-4 py-4 text-sm">
                  <span className="font-medium text-[#083B3C]">{name}</span>
                  <span className="text-[#365456]">{price}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Frequently Asked Questions</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C]">Pricing and trial questions, answered simply</h2>
            <div className="mt-8 grid gap-4">
              {faqItems.map((item) => (
                <div key={item.question} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-[#083B3C]">{item.question}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#5C7173]">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Need help choosing the right plan for your rollout?</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              We can help you choose the right starting plan based on packaging levels, team size, code volume, and rollout stage.
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
          >
            Talk to Sales
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

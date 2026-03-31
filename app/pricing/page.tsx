import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadCheckoutCatalog, type ActiveAddOn, type ActivePlan } from "@/lib/billing/userCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planHighlights = [
  "10-day guided trial activation for INR 1",
  "GTIN or PIC-based product traceability",
  "Unit, box, carton, and pallet hierarchy",
  "Verification history and audit-ready records",
  "Capacity add-ons for seats, plants, and handsets",
  "Commercial plans that scale with rollout volume",
];

const planMarketingByName: Record<
  string,
  {
    featured: boolean;
    cta: string;
    href: string;
    fallbackDescription: string;
    extraItems: string[];
  }
> = {
  starter: {
    featured: false,
    cta: "Start 10-Day Trial",
    href: "/auth/signup",
    fallbackDescription: "For pilot teams starting product traceability with a focused rollout.",
    extraItems: ["GTIN and PIC workflows", "Reports and traceability history"],
  },
  growth: {
    featured: true,
    cta: "Start 10-Day Trial",
    href: "/auth/signup",
    fallbackDescription: "For growing operations that need more team capacity and higher monthly volume.",
    extraItems: ["Everything in Starter", "Guided rollout support"],
  },
  scale: {
    featured: false,
    cta: "Start 10-Day Trial",
    href: "/auth/signup",
    fallbackDescription: "For multi-site operations that need stronger throughput and rollout control.",
    extraItems: ["Priority onboarding support", "Advanced rollout planning"],
  },
};

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

type PricingCard = {
  name: string;
  monthly: string;
  description: string;
  featured: boolean;
  cta: string;
  href: string;
  items: string[];
  quotas: ActivePlan["quotas"];
  capacities: ActivePlan["capacities"];
};

function formatInrFromPaise(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format((value || 0) / 100);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-IN").format(Math.max(0, value || 0));
}

function titleCaseMetric(metric: string): string {
  return metric.charAt(0).toUpperCase() + metric.slice(1);
}

function normalizePlanName(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function planSortWeight(name: string): number {
  if (name === "starter") return 1;
  if (name === "growth") return 2;
  if (name === "scale") return 3;
  return 99;
}

function buildPlanCards(plans: ActivePlan[]): PricingCard[] {
  return plans
    .filter((plan) => plan.billing_cycle === "monthly")
    .sort((a, b) => planSortWeight(normalizePlanName(a.template_name)) - planSortWeight(normalizePlanName(b.template_name)))
    .map((plan) => {
      const normalizedName = normalizePlanName(plan.template_name);
      const marketing = planMarketingByName[normalizedName] || {
        featured: false,
        cta: "Talk to Sales",
        href: "/contact",
        fallbackDescription: "For teams that need a commercial traceability rollout.",
        extraItems: [],
      };

      return {
        name: plan.template_name,
        monthly: `${formatInrFromPaise(plan.plan_price_paise)} / month`,
        description: plan.description || marketing.fallbackDescription,
        featured: marketing.featured,
        cta: marketing.cta,
        href: marketing.href,
        items: [
          `${formatInteger(plan.capacities.plant)} plants`,
          `${formatInteger(plan.capacities.seat)} users`,
          `${formatInteger(plan.capacities.handset)} handsets`,
          `${formatInteger(plan.quotas.unit)} codes / month`,
          ...marketing.extraItems,
        ],
        quotas: plan.quotas,
        capacities: plan.capacities,
      };
    });
}

function buildComparisonRows(planCards: PricingCard[], hasAddOns: boolean) {
  const valuesFor = (mapper: (plan: PricingCard) => string) => planCards.map(mapper);

  return [
    ["10-day trial available", ...valuesFor(() => "Yes"), "Sales-led"],
    ["Trial activation", ...valuesFor(() => "INR 1"), "Custom"],
    ["GTIN workflow support", ...valuesFor(() => "Yes"), "Yes"],
    ["PIC workflow support", ...valuesFor(() => "Yes"), "Yes"],
    ["Packaging hierarchy", ...valuesFor(() => "Yes"), "Yes"],
    ["Plants included", ...valuesFor((plan) => formatInteger(plan.capacities.plant)), "Custom"],
    ["Users included", ...valuesFor((plan) => formatInteger(plan.capacities.seat)), "Custom"],
    ["Handsets included", ...valuesFor((plan) => formatInteger(plan.capacities.handset)), "Custom"],
    ["Included codes / month", ...valuesFor((plan) => formatInteger(plan.quotas.unit)), "Custom"],
    ["Box quota", ...valuesFor((plan) => formatInteger(plan.quotas.box)), "Custom"],
    ["Carton quota", ...valuesFor((plan) => formatInteger(plan.quotas.carton)), "Custom"],
    ["Pallet quota", ...valuesFor((plan) => formatInteger(plan.quotas.pallet)), "Custom"],
    ["Add-ons supported", ...valuesFor(() => (hasAddOns ? "Yes" : "No")), "Yes"],
    ["API / ERP integration", ...valuesFor((plan) => (normalizePlanName(plan.name) === "scale" ? "Available" : "Add-on")), "Included by scope"],
    ["Onboarding support", ...valuesFor((plan) => {
      const normalizedName = normalizePlanName(plan.name);
      if (normalizedName === "starter") return "Standard";
      if (normalizedName === "growth") return "Guided";
      if (normalizedName === "scale") return "Priority";
      return "Standard";
    }), "Dedicated"],
  ];
}

function describeAddOn(addOn: ActiveAddOn): string {
  if (addOn.addon_kind === "structural") {
    const duration = addOn.duration_days ? ` / ${addOn.duration_days} days` : "";
    return `${titleCaseMetric(addOn.entitlement_key)} capacity${duration}`;
  }

  return `${formatInteger(addOn.pricing_unit_size)} ${addOn.entitlement_key} codes`;
}

function formatAddOnPrice(addOn: ActiveAddOn): string {
  const basePrice = formatInrFromPaise(Math.round(addOn.price * 100));
  if (addOn.billing_mode === "recurring" && addOn.duration_days) {
    return `${basePrice} / ${addOn.duration_days} days`;
  }
  if (addOn.billing_mode === "recurring") {
    return `${basePrice} / month`;
  }
  return basePrice;
}

async function loadPricingData() {
  try {
    const supabase = getSupabaseAdmin();
    const catalog = await loadCheckoutCatalog(supabase);
    return {
      planCards: buildPlanCards(catalog.plans),
      comparisonRows: buildComparisonRows(buildPlanCards(catalog.plans), catalog.addOns.length > 0),
      addOns: catalog.addOns,
    };
  } catch (error) {
    console.error("Failed to load pricing catalog", error);
    return {
      planCards: [] as PricingCard[],
      comparisonRows: [] as string[][],
      addOns: [] as ActiveAddOn[],
    };
  }
}

export default async function PricingPage() {
  const { planCards, comparisonRows, addOns } = await loadPricingData();

  const addOnRows = addOns.map((addOn) => ({
    name: addOn.name,
    description: describeAddOn(addOn),
    price: formatAddOnPrice(addOn),
  }));

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
            {planCards.map((plan) => (
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

            <div className="rounded-3xl border border-[#D7E3E4] bg-white p-7 text-[#0F172A] shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0F5D5E]">Custom</p>
              <div className="mt-5">
                <div className="text-3xl font-semibold tracking-tight">Custom pricing</div>
              </div>
              <p className="mt-5 text-sm leading-6 text-[#5C7173]">
                For large regulated deployments with custom workflows, integrations, and support expectations.
              </p>
              <div className="mt-6 space-y-3">
                {[
                  "Custom plants, users, and devices",
                  "Custom code volumes",
                  "API and ERP integration",
                  "Dedicated onboarding",
                  "SLA-backed support",
                  "Commercial scoping by requirement",
                ].map((item) => (
                  <div key={item} className="rounded-2xl bg-[#F7FAFA] px-4 py-3 text-sm text-[#365456]">
                    {item}
                  </div>
                ))}
              </div>
              <Link
                href="/#book-demo"
                className="mt-7 inline-flex w-full items-center justify-center rounded-xl bg-[#0F5D5E] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0B4849]"
              >
                Book a Demo
              </Link>
            </div>
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
                  {planCards.map((plan) => (
                    <th key={plan.name} className="px-6 py-4 font-semibold">
                      {plan.name}
                    </th>
                  ))}
                  <th className="px-6 py-4 font-semibold">Custom</th>
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
              {addOnRows.map((addOn) => (
                <div key={addOn.name} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] px-4 py-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-[#083B3C]">{addOn.name}</span>
                    <span className="text-[#365456]">{addOn.price}</span>
                  </div>
                  <p className="mt-2 text-[#5C7173]">{addOn.description}</p>
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

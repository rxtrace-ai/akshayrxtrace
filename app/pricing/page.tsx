import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

const planHighlights = [
  "Start with a guided trial flow",
  "Create your company and team workspace",
  "Generate GTIN or PIC-based traceability codes",
  "Manage unit, box, carton, and pallet hierarchy",
  "Access reports, scans, and traceability history",
  "Add capacity and usage as your operations grow",
];

const trialSteps = [
  {
    title: "Create your account",
    text: "Use Start Trial to sign up and begin your onboarding flow.",
  },
  {
    title: "Complete company setup",
    text: "Add your business details, team context, and product traceability basics.",
  },
  {
    title: "Explore the platform",
    text: "Set up products, generate codes, and test traceability workflows with your team.",
  },
];

const faqItems = [
  {
    question: "What does Start Trial do?",
    answer: "It takes you into the signup and onboarding flow so you can create your account and begin setting up your company workspace.",
  },
  {
    question: "Can I book a demo before starting?",
    answer: "Yes. If you want guided onboarding or a sales walkthrough, use the Book a Demo option from the site.",
  },
  {
    question: "Does Rxtrace support both GTIN and PIC flows?",
    answer: "Yes. Rxtrace can support GTIN-based workflows when you already have GTIN data, and PIC-based identification when GTIN is not in use.",
  },
  {
    question: "Does Rxtrace verify GTIN ownership?",
    answer: "No. Rxtrace can read and process GTIN structure for workflows, but the company remains solely responsible for valid GTIN ownership and use.",
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
            Start with a guided trial, then scale with your operations
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Rxtrace pricing is designed to keep early onboarding simple and support growth as your traceability volume, team size, and packaging needs expand.
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
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.1fr_0.9fr]">
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Recommended Start</p>
            <h2 className="mt-3 text-3xl font-semibold">Trial First</h2>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              The best way to evaluate Rxtrace is to create your account, complete company setup, and test code generation and traceability flows with your own team.
            </p>
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="text-sm font-semibold text-[#F7C35F]">Best for</div>
              <p className="mt-2 text-sm leading-6 text-[#D7EAEA]">
                Manufacturers, brand owners, distributors, and operations teams who want a practical trial before commercial rollout.
              </p>
            </div>
            <Link
              href="/auth/signup"
              className="mt-8 inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Start Trial
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">How To Start</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              A simple path from trial to rollout
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {trialSteps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-[#D7E3E4] bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold text-[#C17A00]">Step {index + 1}</div>
                <h3 className="mt-3 text-lg font-semibold text-[#083B3C]">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Frequently Asked Questions</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Pricing and trial questions, answered simply
            </h2>
          </div>

          <div className="mt-12 grid gap-5">
            {faqItems.map((item) => (
              <div key={item.question} className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-[#083B3C]">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold">Want plan guidance for your packaging levels or team size?</h2>
            <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
              We can help you decide the right setup based on units, packaging hierarchy, traceability flow, and rollout stage.
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

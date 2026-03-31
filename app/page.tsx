import Image from "next/image";
import Link from "next/link";
import BookDemoForm from "@/components/BookDemoForm";
import LandingAuthLinks from "@/components/LandingAuthLinks";
import LandingApkDownload from "@/components/LandingApkDownload";

const valueCards = [
  {
    title: "Protect Your Brand",
    text: "Give every product a unique identity so your team can spot duplicates, misuse, and counterfeit risk faster.",
  },
  {
    title: "Verify What Is Original",
    text: "Help teams confirm whether a code is genuine across manufacturing, dispatch, warehouse, and market checks.",
  },
  {
    title: "Trace Every Movement",
    text: "Track products from unit to box, carton, and pallet with one consistent traceability flow.",
  },
  {
    title: "Stay Audit Ready",
    text: "Keep clear records for code generation, packaging hierarchy, and traceability reports without extra complexity.",
  },
];

const workflowSteps = [
  "Create your company and product master.",
  "Generate product codes using GTIN or PIC-based flows.",
  "Print labels for units and packaging levels.",
  "Scan and verify products across the supply chain.",
  "Track history and export reports when needed.",
];

const codeModes = [
  {
    title: "GTIN-Based Codes",
    text: "If your product already has a GTIN, Rxtrace uses it to generate standards-aligned traceability codes.",
  },
  {
    title: "PIC-Based Codes",
    text: "If your product does not use GTIN yet, Rxtrace can still help you identify and trace products with PIC-based codes.",
  },
];

const complianceItems = [
  "Supports GS1-aligned traceability workflows",
  "Supports packaging hierarchy from unit to pallet",
  "Supports India-focused pharmaceutical barcode and QR workflows",
  "Supports EU FMD and US DSCSA-style serialization workflows",
];

const industries = [
  "Pharmaceuticals",
  "Medical Devices",
  "Healthcare Products",
  "Cosmetics & Personal Care",
  "Food & Beverage",
  "Consumer Goods",
];

const footerLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/billing-policy", label: "Billing Policy" },
  { href: "/cancellation-policy", label: "Refund & Cancellation" },
  { href: "/compliance", label: "Compliance" },
  { href: "/contact", label: "Help & Support" },
];

export default function HomePage() {
  return (
    <main className="bg-[#F8FAFC] text-[#0F172A]">
      <header className="sticky top-0 z-50 border-b border-[#D7E3E4] bg-[#F8FAFC]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 transition hover:opacity-90">
            <Image src="/logo.png" alt="RxTrace" width={40} height={40} />
            <div>
              <span className="block text-lg font-semibold tracking-tight text-[#083B3C]">RxTrace</span>
              <span className="block text-xs uppercase tracking-[0.24em] text-[#0F5D5E]/70">Be Original</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#365456] md:flex">
            <Link href="#how-it-works" className="hover:text-[#0F5D5E]">How It Works</Link>
            <Link href="#industries" className="hover:text-[#0F5D5E]">Industries</Link>
            <Link href="/compliance" className="hover:text-[#0F5D5E]">Compliance</Link>
            <Link href="/pricing" className="hover:text-[#0F5D5E]">Pricing</Link>
            <Link href="/contact" className="hover:text-[#0F5D5E]">Contact</Link>
          </nav>

          <div className="flex items-center gap-3">
            <LandingAuthLinks
              loginClassName="hidden text-sm font-medium text-[#365456] hover:text-[#0F5D5E] md:inline-flex"
              registerClassName="inline-flex rounded-xl bg-[#0F5D5E] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#083B3C]"
              dashboardClassName="inline-flex rounded-xl border border-[#B9CDCE] px-4 py-2 text-sm font-semibold text-[#0F5D5E] transition hover:border-[#0F5D5E] hover:bg-[#EAF3F3]"
              logoutClassName="inline-flex rounded-xl bg-[#0F5D5E] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#083B3C]"
            />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(15,93,94,0.14),_transparent_40%)]" />
        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 md:grid-cols-[1.15fr_0.85fr] md:py-24">
          <div className="relative">
            <div className="inline-flex rounded-full border border-[#B9CDCE] bg-white/80 px-4 py-1 text-sm font-medium text-[#0F5D5E] shadow-sm">
              Product traceability for original brands
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-[#083B3C] md:text-6xl">
              Be Original.
            </h1>
            <p className="mt-5 max-w-2xl text-xl leading-8 text-[#365456]">
              Rxtrace helps brands protect products from counterfeit, track every unit, and prove authenticity across the supply chain.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#5C7173]">
              Simple code-based traceability for regulated products, from unit to box, carton, and pallet.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-xl bg-[#0F5D5E] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#083B3C]"
              >
                Start Trial
              </Link>
              <Link
                href="#book-demo"
                className="inline-flex items-center justify-center rounded-xl border border-[#C8D9DA] bg-white px-6 py-3 text-sm font-semibold text-[#0F5D5E] transition hover:border-[#0F5D5E] hover:bg-[#EEF5F5]"
              >
                Book a Demo
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#D7E3E4] bg-white/90 p-4 shadow-sm">
                <div className="text-sm font-semibold text-[#083B3C]">Stop Counterfeit</div>
                <p className="mt-2 text-sm text-[#5C7173]">Make product identity visible and harder to fake.</p>
              </div>
              <div className="rounded-2xl border border-[#D7E3E4] bg-white/90 p-4 shadow-sm">
                <div className="text-sm font-semibold text-[#083B3C]">Verify Faster</div>
                <p className="mt-2 text-sm text-[#5C7173]">Help teams check codes quickly across the supply chain.</p>
              </div>
              <div className="rounded-2xl border border-[#D7E3E4] bg-white/90 p-4 shadow-sm">
                <div className="text-sm font-semibold text-[#083B3C]">Stay Audit Ready</div>
                <p className="mt-2 text-sm text-[#5C7173]">Keep clean records for operations and compliance reviews.</p>
              </div>
            </div>
          </div>

          <div
            id="book-demo"
            className="relative rounded-[28px] border border-[#D7E3E4] bg-white p-8 shadow-[0_24px_80px_rgba(8,59,60,0.12)]"
          >
            <div className="inline-flex rounded-full bg-[#FFF4D8] px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#9A6500]">
              Talk to Sales
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-[#083B3C]">See Rxtrace in action</h2>
            <p className="mt-3 text-sm leading-6 text-[#5C7173]">
              Share your details and our team will walk you through anti-counterfeit workflows, code generation, and traceability setup.
            </p>
            <div className="mt-6">
              <BookDemoForm className="space-y-4" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#D7E3E4] bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-16 md:grid-cols-2 lg:grid-cols-4">
          {valueCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-6 shadow-sm">
              <div className="text-lg font-semibold text-[#083B3C]">{card.title}</div>
              <p className="mt-3 text-sm leading-6 text-[#5C7173]">{card.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">How It Works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Clear traceability without complex setup
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              Rxtrace keeps the flow simple so your team can mark, print, verify, and trace products without getting lost in technical steps.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div key={step} className="rounded-2xl border border-[#D7E3E4] bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-[#C17A00]">Step {index + 1}</div>
                <p className="mt-3 text-sm leading-6 text-[#365456]">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-[#D7E3E4] bg-[#083B3C] p-8 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Code Options</p>
            <h2 className="mt-3 text-3xl font-semibold">GTIN or PIC, with one simple explanation</h2>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              If you already use GTIN, Rxtrace works with it. If you do not, Rxtrace can still help you trace products using PIC-based identification.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#D7EAEA]">
              Rxtrace reads structure for code generation workflows, but GTIN ownership and lawful use remain the company&apos;s responsibility.
            </p>
          </div>

          <div className="grid gap-5">
            {codeModes.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-6 shadow-sm">
                <div className="text-lg font-semibold text-[#083B3C]">{item.title}</div>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">{item.text}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-[#F2D9A1] bg-[#FFF8E8] p-6 shadow-sm">
              <div className="text-lg font-semibold text-[#9A6500]">Important Notice</div>
              <p className="mt-3 text-sm leading-6 text-[#7A5A11]">
                Rxtrace does not verify GTIN ownership, licensing, or regulatory validity. The customer is solely responsible for using valid GTINs.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#F3F8F8] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Compliance Support</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
              Built to support regulated traceability workflows
            </h2>
            <p className="mt-4 text-base leading-7 text-[#5C7173]">
              Rxtrace supports clear, audit-friendly traceability records and packaging hierarchy while keeping the language and workflow easy for teams to use.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {complianceItems.map((item) => (
              <div key={item} className="rounded-2xl border border-[#D7E3E4] bg-white p-6 shadow-sm">
                <div className="text-base font-semibold text-[#083B3C]">{item}</div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm text-[#5C7173]">
            Final compliance depends on your implementation and the rules that apply to your market.
          </p>
        </div>
      </section>

      <section id="industries" className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Industries</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
                Designed for brands that need trust and traceability
              </h2>
            </div>
            <Link href="/pricing" className="text-sm font-semibold text-[#0F5D5E] hover:text-[#083B3C]">
              Explore plans
            </Link>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry) => (
              <div key={industry} className="rounded-2xl border border-[#E2ECEC] bg-[#FCFEFE] p-6 shadow-sm">
                <div className="text-lg font-semibold text-[#083B3C]">{industry}</div>
                <p className="mt-3 text-sm leading-6 text-[#5C7173]">
                  Clear product identity, better verification, and stronger traceability for regulated or brand-sensitive goods.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#083B3C] py-20 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Start Now</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Start your traceability setup with a guided trial
            </h2>
            <p className="mt-4 text-base leading-7 text-[#D7EAEA]">
              Use the trial flow to create your account, complete company setup, and begin exploring Rxtrace with your team.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-[#F59E0B] px-6 py-3 text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]"
            >
              Start Trial
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-xl border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-[#062C2D] py-12 text-[#D7EAEA]">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-[1.2fr_1fr_1fr_0.9fr]">
          <div>
            <p className="text-lg font-semibold text-white">RxTrace</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#B7CDCE]">
              Rxtrace is a product traceability platform that helps brands protect original products, reduce counterfeit risk, and maintain clear supply chain records.
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#F7C35F]">Be Original</p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">Company</p>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <Link href="/pricing" className="hover:text-white">Pricing</Link>
              <Link href="/services" className="hover:text-white">Services</Link>
              <Link href="/compliance" className="hover:text-white">Compliance</Link>
              <Link href="/contact" className="hover:text-white">Contact</Link>
              <Link href="/investors" className="hover:text-white">Investors</Link>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">Legal</p>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              {footerLinks.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">Mobile Access</p>
            <LandingApkDownload />
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 px-6 pt-6 text-xs text-[#9FB8B9]">
          Copyright {new Date().getFullYear()} RxTrace India. All rights reserved.
        </div>
      </footer>
    </main>
  );
}

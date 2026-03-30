import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

export default function BillingPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Billing Policy</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Clear billing terms for trial and paid plans</h1>
          <p className="mt-4 text-base leading-7 text-[#D7EAEA]">
            Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="space-y-8 rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Trial Activation</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Rxtrace offers a 10-day trial that is activated through an INR 1 Razorpay payment. The trial starts only after payment confirmation and webhook processing.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[#4E6769]">
              <li>Trial duration is 10 days.</li>
              <li>Trial activation amount is INR 1.</li>
              <li>Trial access starts after payment confirmation.</li>
              <li>Commercial subscription charges apply only if you choose a paid plan later.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Paid Plans</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Paid plans are billed according to the pricing shown on the website or in your checkout flow at the time of purchase. Taxes, add-ons, and discounts are shown before payment confirmation.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[#4E6769]">
              <li>Plan charges are billed in INR unless stated otherwise.</li>
              <li>Add-ons may be charged separately based on the selected configuration.</li>
              <li>Yearly pricing follows the commercial terms shown during checkout.</li>
              <li>Enterprise pricing is provided by custom quotation.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">No Automatic Upgrade</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Completing a trial does not automatically start a paid subscription unless you explicitly choose and pay for a commercial plan.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Refunds</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Subscription fees, setup fees, and add-on charges are generally non-refundable except where required by applicable law or where Rxtrace confirms otherwise in writing.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Contact</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              For billing questions, contact{" "}
              <a href="mailto:billing@rxtrace.in" className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                billing@rxtrace.in
              </a>{" "}
              or visit the{" "}
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

import Link from "next/link";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";

export default function CancellationPolicyPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Cancellation Policy</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">How trial and subscription cancellation works</h1>
          <p className="mt-4 text-base leading-7 text-[#D7EAEA]">
            Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="space-y-8 rounded-3xl border border-[#D7E3E4] bg-white p-8 shadow-sm">
          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Trial Cancellation</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              You can cancel your 3-day trial from the dashboard settings while it is active. Cancellation takes effect immediately and trial access ends at once.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-[#4E6769]">
              <li>Cancel from Dashboard to Settings to Trial.</li>
              <li>Trial access stops immediately after cancellation.</li>
              <li>The INR 1 trial activation amount is not a recurring subscription charge.</li>
              <li>A cancelled trial does not automatically restart.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Paid Subscription Cancellation</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              Paid subscription cancellation terms depend on the plan and billing cycle you choose. Cancelling a subscription stops future renewals, but previously paid fees are generally not refunded except where required by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Effect of Cancellation</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              After cancellation, access to paid or trial-only features may be reduced or removed. Your account and operational data may be retained for a limited period for support, audit, and reactivation purposes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#083B3C]">Contact</h2>
            <p className="mt-4 text-sm leading-7 text-[#4E6769]">
              For cancellation questions, contact{" "}
              <a href="mailto:support@rxtrace.in" className="font-medium text-[#0F5D5E] hover:text-[#083B3C]">
                support@rxtrace.in
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

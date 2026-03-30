"use client";

import Link from "next/link";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import PublicFooter from "@/components/public-site/PublicFooter";
import PublicHeader from "@/components/public-site/PublicHeader";
import TawkToChat from "@/components/TawkToChat";

const faqItems = [
  {
    question: "What is Rxtrace?",
    answer: "Rxtrace is a product traceability platform that helps brands protect original products, reduce counterfeit risk, and maintain clear product records across the supply chain.",
  },
  {
    question: "Who is Rxtrace for?",
    answer: "Rxtrace is useful for manufacturers, brand owners, distributors, warehouses, and other teams that need better product identity, verification, and traceability.",
  },
  {
    question: "Does Rxtrace support GTIN and PIC?",
    answer: "Yes. Rxtrace can support GTIN-based workflows when GTIN is already available, and PIC-based flows when GTIN is not in use.",
  },
  {
    question: "Does Rxtrace verify GTIN ownership?",
    answer: "No. Rxtrace reads GTIN structure for workflows, but GTIN ownership and lawful use remain the company’s sole responsibility.",
  },
  {
    question: "How can we evaluate the platform?",
    answer: "You can start a trial directly from the site or book a guided demo if you want a walkthrough for your team.",
  },
  {
    question: "What support options are available?",
    answer: "You can reach us by email, phone, or live chat. We can help with onboarding, product setup, traceability workflows, and commercial discussions.",
  },
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <PublicHeader current="contact" />

      <section className="bg-[linear-gradient(135deg,#083B3C_0%,#0F5D5E_62%,#2D7677_100%)] text-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#F7C35F]">Contact</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Talk to the Rxtrace team</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-[#D7EAEA]">
            Reach out for product questions, pricing support, onboarding help, demos, or traceability planning for your business.
          </p>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAF3F3] text-[#0F5D5E]">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#083B3C]">Email us</h2>
                    <p className="mt-2 text-sm leading-6 text-[#5C7173]">For support, demos, and commercial questions.</p>
                    <a href="mailto:customer.support@rxtrace.in" className="mt-3 inline-block text-sm font-semibold text-[#0F5D5E] hover:text-[#083B3C]">
                      customer.support@rxtrace.in
                    </a>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF5FF] text-[#2563EB]">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#083B3C]">Call us</h2>
                    <p className="mt-2 text-sm leading-6 text-[#5C7173]">Monday to Saturday, 9 AM to 6 PM IST.</p>
                    <a href="tel:+917768948800" className="mt-3 inline-block text-sm font-semibold text-[#0F5D5E] hover:text-[#083B3C]">
                      +91 77689 48800
                    </a>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF4D8] text-[#9A6500]">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#083B3C]">Office</h2>
                    <p className="mt-2 text-sm leading-6 text-[#5C7173]">
                      RxTrace India
                      <br />
                      Mumbai, Maharashtra
                      <br />
                      India
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-[#083B3C] p-6 text-white shadow-[0_20px_60px_rgba(8,59,60,0.18)]">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-[#F7C35F]" />
                  <h2 className="text-lg font-semibold">Live chat</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#D7EAEA]">
                  Use the chat widget on this page if you want faster help with onboarding, product questions, or demo coordination.
                </p>
              </div>
            </div>

            <div>
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#0F5D5E]">Frequently Asked Questions</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#083B3C] md:text-4xl">
                  Clear answers for common questions
                </h2>
              </div>

              <div className="mt-10 grid gap-5">
                {faqItems.map((item) => (
                  <div key={item.question} className="rounded-2xl border border-[#D7E3E4] bg-[#FCFEFE] p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-[#083B3C]">{item.question}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#5C7173]">{item.answer}</p>
                  </div>
                ))}
              </div>

              <div className="mt-10 rounded-3xl border border-[#F2D9A1] bg-[#FFF8E8] p-8 shadow-sm">
                <h2 className="text-2xl font-semibold text-[#9A6500]">Ready to see Rxtrace in action?</h2>
                <p className="mt-3 text-sm leading-6 text-[#7A5A11]">
                  Start your trial now, or book a demo if you want a guided walkthrough for your team.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/auth/signup"
                    className="inline-flex items-center justify-center rounded-xl bg-[#0F5D5E] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#083B3C]"
                  >
                    Start Trial
                  </Link>
                  <Link
                    href="/#book-demo"
                    className="inline-flex items-center justify-center rounded-xl border border-[#CDAA4A] bg-white px-6 py-3 text-sm font-semibold text-[#9A6500] transition hover:bg-[#FFF6E2]"
                  >
                    Book a Demo
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
      <TawkToChat />
    </main>
  );
}

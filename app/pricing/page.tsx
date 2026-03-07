"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";

/* =========================================================
   TRIAL-ONLY PRICING PAGE
   ========================================================= */

export default function PricingPage() {
  return (
    <main className="bg-white text-slate-900">
      {/* HEADER */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="RxTrace" width={36} height={36} />
            <span className="font-semibold">RxTrace</span>
          </Link>
          <nav className="flex gap-6 text-sm">
            <Link href="/services">Services</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/auth/signin">Login</Link>
          </nav>
        </div>
      </header>

      {/* HERO - FREE TRIAL */}
      <section className="bg-blue-600 text-white text-center py-16">
        <h1 className="text-4xl font-bold">Start Free - No Credit Card Required</h1>
        <p className="mt-4 text-blue-100 text-lg max-w-2xl mx-auto">
          Activate a 10-day trial with a â‚¹1 Razorpay verification payment. Generate GS1-compliant labels,
          trace your products through the supply chain, and more.
        </p>
        <div className="mt-8">
          <Link 
            href="/auth/signin" 
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition"
          >
            Start Free Trial
          </Link>
        </div>
        <p className="mt-4 text-sm text-blue-200">
          â‚¹1 activation • Full feature access • Cancel anytime
        </p>
      </section>

      {/* TRIAL FEATURES */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Everything Included in Free Trial</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <FeatureCard 
              title="Unlimited Label Generation"
              description="Generate Unit, Box, Carton, and Pallet (SSCC) codes without any limits during your trial period."
            />
            <FeatureCard 
              title="GS1 Compliance"
              description="All labels meet GS1 standards for global supply chain interoperability."
            />
            <FeatureCard 
              title="Supply Chain Tracking"
              description="Track products from manufacturer to end consumer with full traceability."
            />
            <FeatureCard 
              title="Multi-User Access"
              description="Invite your team members and collaborate on label generation and tracking."
            />
            <FeatureCard 
              title="ERP Integration"
              description="Import codes from your ERP system and export generated labels."
            />
            <FeatureCard 
              title="Mobile Scanning"
              description="Use mobile devices to scan and verify products throughout the supply chain."
            />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-gray-50 py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-12">How to Start Your Free Trial</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard 
              number="1"
              title="Create Account"
              description="Sign up with your business email. No credit card required."
            />
            <StepCard 
              number="2"
              title="Verify Company"
              description="Complete quick company verification to unlock full access."
            />
            <StepCard 
              number="3"
              title="Start Generating"
              description="Generate GS1-compliant labels and track your products immediately."
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <FAQItem 
              question="Is the trial really free?"
              answer="The trial requires a â‚¹1 Razorpay activation payment for verification. No recurring charges are applied unless you choose to subscribe."
            />
            <FAQItem 
              question="What happens after the trial ends?"
              answer="After the 15-day trial, you can continue using RxTrace by subscribing to one of our plans. Your data and settings will be preserved."
            />
            <FAQItem 
              question="Can I cancel anytime?"
              answer="Yes, you can cancel your trial at any time from your dashboard settings. No questions asked, no cancellation fees."
            />
            <FAQItem 
              question="Is there a limit on label generation during trial?"
              answer="No limits! Generate as many Unit, Box, Carton, and SSCC codes as you need during your trial period."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 text-white text-center py-16">
        <h2 className="text-2xl font-bold">Ready to Get Started?</h2>
        <p className="mt-4 text-blue-100">
          Join thousands of businesses using RxTrace for supply chain traceability.
        </p>
        <div className="mt-8">
          <Link 
            href="/auth/signin" 
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition"
          >
            Start Your Free Trial
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="RxTrace" width={24} height={24} />
            <span className="font-semibold">RxTrace</span>
          </div>
          <nav className="flex gap-6 text-sm text-gray-600">
            <Link href="/services">Services</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/billing-policy">Billing Policy</Link>
            <Link href="/cancellation-policy">Cancellation Policy</Link>
          </nav>
          <p className="text-sm text-gray-500">
            © 2025 RxTrace. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-gray-50 p-6 rounded-lg">
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="relative">
      <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xl mx-auto mb-4">
        {number}
      </div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="border-b pb-6">
      <h3 className="font-semibold text-lg mb-2">{question}</h3>
      <p className="text-gray-600">{answer}</p>
    </div>
  );
}

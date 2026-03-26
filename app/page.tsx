// Next.js 14 App Router – Production-ready RxTrace Landing Page
// Path: app/page.tsx

import Image from "next/image";
import Link from "next/link";
import BookDemoForm from "@/components/BookDemoForm";
import LandingAuthLinks from "@/components/LandingAuthLinks";
import LandingApkDownload from "@/components/LandingApkDownload";

export default function HomePage() {
  return (
    <main className="bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <Image src="/logo.png" alt="RxTrace" width={36} height={36} />
            <span className="font-semibold text-lg">RxTrace</span>
          </Link>
          <nav className="hidden md:flex gap-8 text-sm font-medium">
            <Link href="/compliance">Compliance</Link>
            <Link href="/services">Services</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/contact">Contact Us</Link>
          </nav>
          <div className="flex items-center gap-4">
            <LandingAuthLinks
              loginClassName="text-sm"
              registerClassName="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm shadow hover:bg-blue-700"
            />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-blue-700 to-blue-500 text-white">
        <div className="max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight">
              Enterprise-Grade Pharmaceutical Traceability
            </h1>
            <p className="mt-6 text-lg text-blue-100">
              GS1-compliant unit-to-pallet tracking with zero consumer data capture.
            </p>
            <ul className="mt-8 space-y-3 text-sm">
              <li>✔ GS1 QR & DataMatrix only</li>
              <li>✔ Unit → Box → Carton → Pallet (SSCC)</li>
              <li>✔ Code-only security model</li>
            </ul>
          </div>

          <div id="book-demo" className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-8 text-slate-900">
            <h3 className="text-lg font-semibold mb-4">Book a Demo</h3>
            <BookDemoForm className="space-y-4" />
          </div>
        </div>
      </section>

{/* Compliance Overview */}
<section className="py-20 bg-slate-50">
  <div className="max-w-7xl mx-auto px-6">
    <h2 className="text-3xl font-semibold text-center">
      Regulatory Compliance Overview
    </h2>
    <p className="text-center text-slate-600 mt-4 max-w-3xl mx-auto">
      RxTrace supports GS1-aligned serialization and traceability workflows
      required under major global and Indian pharmaceutical regulations.
    </p>

    <div className="mt-12 grid md:grid-cols-4 gap-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="font-semibold mb-2">EU-FMD</h3>
        <p className="text-sm text-slate-600">
          Mandatory GS1 DataMatrix with unique identifier for prescription
          medicines across the European Union.
        </p>
        <a href="/compliance" className="text-sm text-blue-600 font-medium mt-3 inline-block">
          Read more →
        </a>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="font-semibold mb-2">US-FDA (DSCSA)</h3>
        <p className="text-sm text-slate-600">
          Serialized product identifiers required for interoperable electronic
          tracing of prescription drugs.
        </p>
        <a href="/compliance" className="text-sm text-blue-600 font-medium mt-3 inline-block">
          Read more →
        </a>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="font-semibold mb-2">Indian FDA</h3>
        <p className="text-sm text-slate-600">
          QR / barcode mandate for top drug formulations under amended Drugs &
          Cosmetics Rules.
        </p>
        <a href="/compliance" className="text-sm text-blue-600 font-medium mt-3 inline-block">
          Read more →
        </a>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="font-semibold mb-2">CDSCO</h3>
        <p className="text-sm text-slate-600">
          GS1-based identification and traceability aligned with India’s central
          drug regulator guidelines.
        </p>
        <a href="/compliance" className="text-sm text-blue-600 font-medium mt-3 inline-block">
          Read more →
        </a>
      </div>
    </div>
  </div>
</section>

{/* How RxTrace Works */}
<section className="py-24 bg-slate-50">
  <div className="max-w-7xl mx-auto px-6">
    <h2 className="text-3xl font-semibold text-center">
      How RxTrace Works
    </h2>
    <p className="text-center text-slate-600 mt-4 max-w-3xl mx-auto">
      A simple GS1 compliant traceability process from company setup
      to label generation and printing.
    </p>

    {/* Flow Grid */}
    <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">

      {/* STEP 1 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 1</div>
        <h3 className="mt-2 font-semibold">Setup Company</h3>
        <p className="mt-2 text-sm text-slate-600">
          Register company details and compliance profile once in the system.
        </p>
      </div>

      {/* STEP 2 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 2</div>
        <h3 className="mt-2 font-semibold">Create SKU Master</h3>
        <p className="mt-2 text-sm text-slate-600">
          Create SKU Master records manually or upload CSV with fixed Unit
          fields such as SKU code, batch, expiry, optional MFD, optional MRP,
          and optional GTIN.
        </p>
      </div>

      {/* STEP 3 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 3</div>
        <h3 className="mt-2 font-semibold">Select SKU for Generation</h3>
        <p className="mt-2 text-sm text-slate-600">
          Unit generation reads fixed payload values from SKU Master so users
          only select SKU and enter quantity during generation.
        </p>
      </div>

      {/* STEP 4 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 4</div>
        <h3 className="mt-2 font-semibold">Setup Printer</h3>
        <p className="mt-2 text-sm text-slate-600">
          Configure printer or output format such as PDF, PNG, EPL, or ZPL.
        </p>
      </div>

      {/* STEP 5 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 5</div>
        <h3 className="mt-2 font-semibold">Set Packaging Rules</h3>
        <p className="mt-2 text-sm text-slate-600">
          Define box, carton and pallet hierarchy using SSCC rules.
        </p>
      </div>

      {/* STEP 6 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 6</div>
        <h3 className="mt-2 font-semibold">Generate Unit Payload</h3>
        <p className="mt-2 text-sm text-slate-600">
          RxTrace generates GS1 automatically when GTIN exists in SKU Master,
          otherwise it generates PIC, always with backend-created serials.
        </p>
      </div>

      {/* STEP 7 */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-blue-600 font-semibold text-sm">Step 7</div>
        <h3 className="mt-2 font-semibold">Add to Batch</h3>
        <p className="mt-2 text-sm text-slate-600">
          Generated payloads are grouped into batches for controlled processing.
        </p>
      </div>

      {/* STEP 8 */}
      <div className="bg-white rounded-xl shadow p-6 border border-blue-600">
        <div className="text-blue-600 font-semibold text-sm">Step 8</div>
        <h3 className="mt-2 font-semibold">Generate & Print Codes</h3>
        <p className="mt-2 text-sm text-slate-600">
          Export labels in PDF, PNG, EPL, ZPL format or print directly.
        </p>
      </div>

    </div>
  </div>
</section>

      {/* Industry Support */}
<section className="py-20">
  <div className="max-w-7xl mx-auto px-6">
    <h2 className="text-3xl font-semibold text-center">
      Industry Support
    </h2>
    <p className="text-center text-slate-600 mt-4 max-w-3xl mx-auto">
      RxTrace is designed to support all key participants in the regulated
      supply chain with a single GS1 compliant traceability system.
    </p>

    <div className="mt-12 grid md:grid-cols-4 gap-6 text-sm">
      <div className="bg-slate-50 rounded-xl p-6 text-center">
        <h3 className="font-semibold mb-2">Manufacturers</h3>
        <ul className="space-y-2 text-slate-700">
          <li>Generate GS1 QR or DataMatrix codes</li>
          <li>Serialize products at unit level</li>
          <li>Meet India, US, and EU regulations</li>
          <li>Prepare audit ready reports</li>
        </ul>
      </div>

      <div className="bg-slate-50 rounded-xl p-6 text-center">
        <h3 className="font-semibold mb-2">Distributors</h3>
        <ul className="space-y-2 text-slate-700">
          <li>Verify incoming and outgoing shipments</li>
          <li>Scan cartons and pallets using SSCC</li>
          <li>Handle partial shipments easily</li>
          <li>No access to manufacturer sensitive data</li>
        </ul>
      </div>

      <div className="bg-slate-50 rounded-xl p-6 text-center">
        <h3 className="font-semibold mb-2">Warehouses</h3>
        <ul className="space-y-2 text-slate-700">
          <li>Quick receiving and dispatch scanning</li>
          <li>Pallet and carton level visibility</li>
          <li>Support cold chain and 3PL operations</li>
          <li>Reduce manual inventory errors</li>
        </ul>
      </div>

      <div className="bg-slate-50 rounded-xl p-6 text-center">
        <h3 className="font-semibold mb-2">Logistics</h3>
        <ul className="space-y-2 text-slate-700">
          <li>Track movement without data duplication</li>
          <li>Scan once, use everywhere</li>
          <li>Compatible with existing workflows</li>
          <li>Improved traceability across transit</li>
        </ul>
      </div>
    </div>
  </div>
</section>


      {/* Data Security */}
<section className="py-20 bg-slate-900 text-white">
  <div className="max-w-7xl mx-auto px-6">
    <h2 className="text-3xl font-semibold text-center">
      Data Security and Trust
    </h2>
    <p className="text-center text-slate-300 mt-4 max-w-3xl mx-auto">
      RxTrace follows a code centric security model that minimizes data exposure
      while meeting regulatory traceability requirements.
    </p>

    <div className="mt-12 grid md:grid-cols-4 gap-6 text-sm">
      <div className="bg-white/10 rounded-xl p-6">
        <h3 className="font-semibold mb-2">Code Only Architecture</h3>
        <ul className="space-y-2 text-slate-200">
          <li>All trust is embedded inside GS1 codes</li>
          <li>No dependency on personal data</li>
          <li>Works even without internet access</li>
        </ul>
      </div>

      <div className="bg-white/10 rounded-xl p-6">
        <h3 className="font-semibold mb-2">No Consumer Data Capture</h3>
        <ul className="space-y-2 text-slate-200">
          <li>No patient or consumer tracking</li>
          <li>No scan level personal data stored</li>
          <li>Privacy safe by design</li>
        </ul>
      </div>

      <div className="bg-white/10 rounded-xl p-6">
        <h3 className="font-semibold mb-2">Controlled Access</h3>
        <ul className="space-y-2 text-slate-200">
          <li>Role based user permissions</li>
          <li>Token based handset activation</li>
          <li>Higher scans enabled only when authorized</li>
        </ul>
      </div>

      <div className="bg-white/10 rounded-xl p-6">
        <h3 className="font-semibold mb-2">Audit Ready</h3>
        <ul className="space-y-2 text-slate-200">
          <li>Immutable generation logs</li>
          <li>Packaging and aggregation history</li>
          <li>Regulator friendly reports</li>
        </ul>
      </div>
    </div>
  </div>
</section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-12">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-8">
          <div>
            <p className="font-semibold text-white">RxTrace</p>
            <p className="text-sm mt-2">
              RxTrace is a traceability and serialization platform enabling secure product tracking using GS1-compliant codes across the supply chain.
            </p>
          </div>
          <div>
            <table className="text-sm w-full">
              <tbody>
                <tr>
                  <td className="py-1">
                    <Link href="/privacy" className="text-slate-300 hover:text-white">Privacy Policy</Link>
                  </td>
                </tr>
                <tr>
                  <td className="py-1">
                    <Link href="/terms" className="text-slate-300 hover:text-white">User Policy</Link>
                  </td>
                </tr>
                <tr>
                  <td className="py-1">
                    <Link href="/billing-policy" className="text-slate-300 hover:text-white">Billing Policy</Link>
                  </td>
                </tr>
                <tr>
                  <td className="py-1">
                    <Link href="/cancellation-policy" className="text-slate-300 hover:text-white">Cancellation & Refund Policy</Link>
                  </td>
                </tr>
                <tr>
                  <td className="py-1">
                    <Link href="/contact" className="text-slate-300 hover:text-white">Help & Support</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-sm space-y-2">
            <Link href="#">LinkedIn</Link>
            <Link href="#">X</Link>
          </div>
          <div>
            <LandingApkDownload />
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-8">© {new Date().getFullYear()} RxTrace India. All rights reserved.</p>
      </footer>
    </main>
  );
}
type FlowStepProps = {
  step: string
  title: string
  text: string
  align: "top" | "bottom"
  highlight?: boolean
}

function FlowStep({
  step,
  title,
  text,
  align,
  highlight
}: FlowStepProps) {
  return (
    <div
      className={`flex flex-col items-center text-center ${
        align === "top" ? "-mt-28" : "mt-28"
      }`}
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold ${
          highlight ? "bg-blue-600" : "bg-blue-500"
        }`}
      >
        {step}
      </div>

      <h3 className="mt-4 font-semibold text-sm text-blue-400 max-w-[180px]">
        {title}
      </h3>

      <p className="mt-2 text-xs text-slate-400 max-w-[180px]">
        {text}
      </p>
    </div>
  )
}

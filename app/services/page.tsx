// Next.js 14 App Router – Services Page
// Path: app/services/page.tsx
// Production-ready, regulator-safe, enterprise SaaS

import Link from "next/link";
import Image from "next/image";

export default function ServicesPage() {
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
            <Link href="/services" className="text-blue-600">Services</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/contact">Contact Us</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm">Log in</Link>
            <Link href="/auth/signup" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm shadow hover:bg-blue-700">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-800 to-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <h1 className="text-4xl md:text-5xl font-bold max-w-3xl">
            RxTrace Services
          </h1>
          <p className="mt-6 text-lg text-blue-100 max-w-3xl">
            End to end GS1 compliant traceability services designed for regulated pharmaceutical, food, dairy, and supply chain operations.
          </p>
        </div>
      </section>

      {/* Core Services */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-semibold text-center">Core Traceability Services</h2>
          <p className="text-center text-slate-600 mt-4 max-w-3xl mx-auto">
            RxTrace provides modular services that can be deployed independently or as a complete traceability stack.
          </p>

          <div className="mt-12 grid md:grid-cols-2 gap-8">

            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">GS1 Label Generation</h3>
              <ul className="text-sm space-y-2">
                <li>Generation of GS1 QR and DataMatrix codes</li>
                <li>Unit level serialization with unique serial numbers</li>
                <li>Support for GTIN, batch, expiry, manufacturing date</li>
                <li>Compliance with EU FMD, US DSCSA, Indian FDA, CDSCO</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Packaging Rules and Aggregation</h3>
              <ul className="text-sm space-y-2">
                <li>Define unit to box to carton to pallet hierarchy</li>
                <li>Automatic SSCC generation for logistic units</li>
                <li>Aggregation logic aligned with warehouse workflows</li>
                <li>Supports distributor and logistics operations</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Scanner Applications</h3>
              <ul className="text-sm space-y-2">
                <li>Mobile scanner apps for GS1 QR and DataMatrix</li>
                <li>Unit, box, carton, and pallet scanning support</li>
                <li>Offline capable verification</li>
                <li>No consumer or patient data capture</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Compliance and Audit Support</h3>
              <ul className="text-sm space-y-2">
                <li>Audit ready report generation</li>
                <li>Packaging rule and code generation logs</li>
                <li>Regulator friendly PDF and CSV exports</li>
                <li>Supports inspections and compliance reviews</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Advanced Services */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-semibold text-center">Advanced & Enterprise Services</h2>
          <div className="mt-12 grid md:grid-cols-2 gap-8">

            <div className="border rounded-xl p-6 bg-white">
              <h3 className="text-xl font-semibold mb-3">Multi Location Manufacturing Support</h3>
              <ul className="text-sm space-y-2">
                <li>Support for multiple plants and contract manufacturers</li>
                <li>Separation of brand owner and manufacturer data</li>
                <li>GS1 compliant workflows across facilities</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-white">
              <h3 className="text-xl font-semibold mb-3">Distributor and Warehouse Enablement</h3>
              <ul className="text-sm space-y-2">
                <li>SSCC based pallet and carton scanning</li>
                <li>Inbound and outbound traceability support</li>
                <li>Compatible with third party logistics partners</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-white">
              <h3 className="text-xl font-semibold mb-3">Security and Access Control</h3>
              <ul className="text-sm space-y-2">
                <li>Role based access for users and operators</li>
                <li>Token based handset activation</li>
                <li>Controlled access to higher level scans</li>
              </ul>
            </div>

            <div className="border rounded-xl p-6 bg-white">
              <h3 className="text-xl font-semibold mb-3">Integration and Deployment</h3>
              <ul className="text-sm space-y-2">
                <li>Cloud ready SaaS deployment</li>
                <li>API based integration with ERP or MES systems</li>
                <li>Scalable architecture for production environments</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-semibold text-center">Industry Use Cases</h2>
          <p className="text-center text-slate-600 mt-4 max-w-3xl mx-auto">
            RxTrace supports different roles in the supply chain with simple, practical workflows while keeping the same GS1 compliant traceability foundation.
          </p>

          <div className="mt-12 grid md:grid-cols-4 gap-8">

            {/* Manufacturer */}
            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Manufacturers</h3>
              <ul className="text-sm space-y-2">
                <li>Create GS1 QR or DataMatrix codes for every product unit</li>
                <li>Automatically group units into boxes, cartons, and pallets</li>
                <li>Meet regulatory requirements for India, US, and EU markets</li>
                <li>Download audit reports for inspections and exports</li>
              </ul>
            </div>

            {/* Distributor */}
            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Distributors</h3>
              <ul className="text-sm space-y-2">
                <li>Scan cartons or pallets to verify product authenticity</li>
                <li>Track incoming and outgoing shipments easily</li>
                <li>Handle partial deliveries without breaking traceability</li>
                <li>No access to manufacturer confidential data</li>
              </ul>
            </div>

            {/* Warehouse */}
            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Warehouses</h3>
              <ul className="text-sm space-y-2">
                <li>Quickly receive and dispatch goods using pallet or carton scans</li>
                <li>Maintain clear visibility of stock movement</li>
                <li>Support third party logistics and cold chain operations</li>
                <li>Reduce manual errors in inventory handling</li>
              </ul>
            </div>

            {/* Logistics */}
            <div className="border rounded-xl p-6 bg-slate-50">
              <h3 className="text-xl font-semibold mb-3">Logistics</h3>
              <ul className="text-sm space-y-2">
                <li>Track shipment movement across transport stages</li>
                <li>Scan cartons or pallets without breaking traceability</li>
                <li>Support handover between transporter and warehouse</li>
                <li>No access to manufacturer or pricing sensitive data</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-blue-700 text-white text-center">
        <h2 className="text-2xl font-semibold">Looking for a Complete Traceability Solution</h2>
        <p className="mt-4 text-blue-100 max-w-2xl mx-auto">
          Our services are designed to scale with your regulatory and operational needs.
        </p>
        <div className="mt-6">
          <Link href="/#book-demo" className="px-6 py-3 bg-white text-blue-700 rounded-xl font-medium">
            Book a Demo
          </Link>
        </div>
      </section>

    </main>
  );
}

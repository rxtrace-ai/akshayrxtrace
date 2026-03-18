import Link from 'next/link';
import Image from 'next/image';

export default function CancellationPolicyPage() {
  return (
    <main className="bg-white text-slate-900 min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur bg-white/80 border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <Image src="/logo.png" alt="RxTrace" width={36} height={36} />
            <span className="font-semibold text-lg">RxTrace</span>
          </Link>
          <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Cancellation Policy</h1>
        <p className="text-gray-600 mb-8">Last updated: {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <div className="prose prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold mb-4">Free Trial Cancellation</h2>
            <p className="text-gray-700 mb-4">
              You can cancel your 15-day free trial at any time from your dashboard settings. 
              Cancellation results in immediate loss of access to all features.
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700">
              <li>Cancel anytime from Dashboard → Settings → Trial Management</li>
              <li>Immediate effect - access is revoked right away</li>
              <li>No charges - the trial is completely free</li>
              <li>No questions asked</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">How to Cancel Your Trial</h2>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <ol className="list-decimal list-inside space-y-3 text-gray-700">
                <li>Log in to your RxTrace dashboard</li>
                <li>Navigate to Settings</li>
                <li>Find the Trial Management section</li>
                <li>Click on &quot;Cancel Trial&quot;</li>
                <li>Confirm your cancellation</li>
              </ol>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">No Charges or Refunds</h2>
            <p className="text-gray-700 mb-4">
              Since the trial is completely free, there are no charges to refund:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-700">
              <li>No payment information is collected during trial signup</li>
              <li>No charges are applied during or after the trial</li>
              <li>No refund policy applies since no payments are made</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Data Retention</h2>
            <p className="text-gray-700 mb-4">
              After trial cancellation, your account data is retained for a limited period. 
              If you restart your trial within 30 days, your data will still be available.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p className="text-gray-700">
              For cancellation requests or questions about this policy, please contact us at{' '}
              <a href="mailto:support@rxtrace.in" className="text-blue-600 hover:underline">
                support@rxtrace.in
              </a>
              {' '}or visit our{' '}
              <Link href="/contact" className="text-blue-600 hover:underline">
                Contact Us
              </Link>
              {' '}page.
            </p>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-12 mt-16">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} RxTrace. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

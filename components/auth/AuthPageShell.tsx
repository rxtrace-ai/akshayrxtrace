import { Check, Cloud, QrCode, ShieldCheck } from "lucide-react";

export function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <div className="grid min-h-screen md:grid-cols-[35%_65%] lg:grid-cols-[45%_55%]">
        <aside className="hidden bg-[#0F4C81] px-10 py-10 text-white md:flex md:flex-col md:justify-between lg:px-14">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#0F4C81] shadow-lg">
                <ShieldCheck className="h-7 w-7" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold">RxTrace</p>
                <p className="text-xs font-bold tracking-[0.28em] text-blue-100">BE ORIGINAL</p>
              </div>
            </div>

            <div className="mt-24 max-w-xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-blue-100">
                Enterprise Healthcare SaaS
              </p>
              <h1 className="text-4xl font-bold leading-tight lg:text-5xl">Brand Security &amp; GS1 Traceability</h1>
              <p className="mt-6 text-base leading-8 text-blue-50 lg:text-lg">
                Protect pharmaceutical products against counterfeit using GS1 compliant serialization,
                QR codes and end-to-end supply chain traceability.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              {[
                { label: "GS1 Compliant", icon: <QrCode className="h-4 w-4" aria-hidden="true" /> },
                { label: "CDSCO Ready", icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" /> },
                { label: "Cloud SaaS", icon: <Cloud className="h-4 w-4" aria-hidden="true" /> },
              ].map((badge) => (
                <span key={badge.label} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur">
                  <Check className="h-4 w-4 text-blue-100" aria-hidden="true" />
                  {badge.icon}
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          <p className="text-sm font-medium text-blue-100">&copy; 2026 RxTrace</p>
        </aside>

        <section className="flex min-h-screen items-center justify-center px-6 py-8 sm:px-8 md:px-10">
          <div className="w-full max-w-[420px]">
            <div className="mb-8 flex items-center gap-3 md:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0F4C81] text-white shadow-lg">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0F4C81]">RxTrace</p>
                <p className="text-xs font-bold tracking-[0.26em] text-[#1E88E5]">BE ORIGINAL</p>
              </div>
            </div>
            {children}
            <footer className="mt-6 text-center text-xs leading-6 text-slate-500">
              <p>By continuing you agree to RxTrace Terms &amp; Privacy Policy.</p>
              <p className="font-semibold text-slate-600">&copy; 2026 RxTrace &bull; GS1 Compliant Platform</p>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}

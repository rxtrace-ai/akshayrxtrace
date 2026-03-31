import Link from "next/link";
import LandingApkDownload from "@/components/LandingApkDownload";

const companyLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/services", label: "Services" },
  { href: "/compliance", label: "Compliance" },
  { href: "/contact", label: "Contact" },
  { href: "/investors", label: "Investors" },
];

const legalLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/billing-policy", label: "Billing Policy" },
  { href: "/cancellation-policy", label: "Refund & Cancellation" },
];

export default function PublicFooter() {
  return (
    <footer className="bg-[#062C2D] py-12 text-[#D7EAEA]">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-[1.2fr_1fr_1fr_0.9fr]">
        <div>
          <p className="text-lg font-semibold text-white">RxTrace</p>
          <p className="mt-3 max-w-sm text-sm leading-6 text-[#B7CDCE]">
            Rxtrace helps brands protect original products, reduce counterfeit risk, and maintain clear product traceability across the supply chain.
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#F7C35F]">Be Original</p>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">Company</p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            {companyLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white">
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">Legal</p>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            {legalLinks.map((link) => (
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
  );
}

import Image from "next/image";
import Link from "next/link";
import LandingAuthLinks from "@/components/LandingAuthLinks";

type PublicHeaderProps = {
  current?: "compliance" | "pricing" | "contact";
};

const navItems = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#industries", label: "Industries" },
  { href: "/compliance", label: "Compliance", key: "compliance" },
  { href: "/pricing", label: "Pricing", key: "pricing" },
  { href: "/contact", label: "Contact", key: "contact" },
] as const;

export default function PublicHeader({ current }: PublicHeaderProps) {
  return (
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
          {navItems.map((item) => {
            const isActive = "key" in item && item.key === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? "text-[#0F5D5E]" : "hover:text-[#0F5D5E]"}
              >
                {item.label}
              </Link>
            );
          })}
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
  );
}

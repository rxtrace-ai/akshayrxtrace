"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  QrCode,
  Boxes,
  Search,
  ScanLine,
  FileText,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  TreeDeciduous,
  Users,
  CreditCard,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MENU = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "SKU Master", path: "/dashboard/sku", icon: Package },
  { label: "Code Generation", path: "/dashboard/code-generation", icon: QrCode },
  { label: "Trace Hierarchy", path: "/dashboard/search", icon: Boxes },
  { label: "Plant Management", path: "/dashboard/plants", icon: TreeDeciduous },
  { label: "Seat Management", path: "/dashboard/seats", icon: Users },
  { label: "Subscription", path: "/dashboard/subscription", icon: CreditCard },
  { label: "Add-ons", path: "/dashboard/add-ons", icon: CreditCard },
  { label: "Handsets", path: "/dashboard/handsets", icon: Smartphone },
  { label: "Scan Logs", path: "/dashboard/scans", icon: ScanLine },
  { label: "Reports", path: "/dashboard/audit", icon: FileText },
  { label: "Help & Support", path: "/dashboard/help", icon: HelpCircle },
  { label: "Settings", path: "/dashboard/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-[#0F5D5E] bg-[#083B3C] text-[#D7EAEA] transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center justify-between border-b border-[#0F5D5E] px-4">
        {!collapsed && (
          <Link href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-lg font-semibold hover:opacity-80 transition">
            <Image src="/logo.png" alt="RxTrace" width={32} height={32} />
            <div>
              <span className="block text-white">RxTrace</span>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-[#F7C35F]">Be Original</span>
            </div>
          </Link>
        )}
        {collapsed && (
          <Link href="/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-full">
            <Image src="/logo.png" alt="RxTrace" width={32} height={32} />
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-md p-1.5 text-[#9FC2C4] transition hover:bg-[#0F5D5E] hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {MENU.map((item) => {
          const active = pathname === item.path || pathname?.startsWith(item.path + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.path}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                collapsed ? "justify-center" : "",
                active
                  ? "bg-[#0F5D5E] font-medium text-white"
                  : "text-[#C7DFE0] hover:bg-[#0D4748] hover:text-white"
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { Bell, LogOut, User, Settings as SettingsIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import Link from "next/link";

type HeaderState = {
  companyName: string | null;
  profileInitial: string;
  userEmail: string | null;
};

export default function Header() {
  const router = useRouter();
  const [state, setState] = useState<HeaderState>({
    companyName: null,
    profileInitial: "A",
    userEmail: null,
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [showWelcomeNotification, setShowWelcomeNotification] = useState(false);

  const companyText = useMemo(() => state.companyName ?? "RxTrace", [state.companyName]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: { user } } = await supabaseClient().auth.getUser();
        if (!user) return;

        const emailInitial = (user.email || "").trim().charAt(0).toUpperCase();
        const nameInitial = (String((user.user_metadata as any)?.full_name ?? "").trim().charAt(0) || "").toUpperCase();
        const initial = nameInitial || emailInitial || "A";

        const res = await fetch("/api/company/profile/update", { method: "GET", cache: "no-store" });
        const body = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok) {
          setState({
            companyName: body?.company_name ?? null,
            profileInitial: initial,
            userEmail: user.email ?? null,
          });
        } else {
          setState((prev) => ({ ...prev, profileInitial: initial, userEmail: user.email ?? null }));
        }

        // Check for first login welcome notification
        const hasSeenWelcome = localStorage.getItem("rxtrace_welcome_seen");
        if (!hasSeenWelcome) {
          setShowWelcomeNotification(true);
          setUnreadCount(1);
        }
      } catch {
        // keep header stable even if fetch fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await supabaseClient().auth.signOut();
    router.push("/login");
  };

  const handleMarkAsRead = () => {
    setUnreadCount(0);
    setShowWelcomeNotification(false);
    localStorage.setItem("rxtrace_welcome_seen", "true");
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-[#0F5D5E] bg-[#083B3C] px-6">
      {/* Left: Application Name */}
      <div className="flex items-center">
        <h1 className="text-xl font-semibold text-white">RxTrace</h1>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-4">
        {/* Notification Bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative rounded-md p-2 text-[#C7DFE0] transition hover:bg-[#0F5D5E] hover:text-white"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-500 border-0">
                  {unreadCount}
                </Badge>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showWelcomeNotification ? (
              <div className="p-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">
                    Welcome to RxTrace
                  </p>
                  <p className="text-sm text-gray-600">
                    Your system is ready for pharmaceutical traceability.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Link
                      href="/dashboard"
                      onClick={handleMarkAsRead}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                    >
                      Go to Dashboard
                    </Link>
                    <button
                      onClick={handleMarkAsRead}
                      className="text-xs px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md transition"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm text-gray-500 text-center">
                No new notifications
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Company Name */}
        {state.companyName && (
          <div className="hidden rounded-md bg-[#0F5D5E] px-3 py-1.5 text-sm text-[#D7EAEA] md:block">
            {companyText}
          </div>
        )}

        {/* Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F59E0B] text-sm font-semibold text-[#083B3C] transition hover:bg-[#F7B733]">
              {state.profileInitial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">Account</p>
                {state.userEmail && (
                  <p className="text-xs text-gray-500 truncate">{state.userEmail}</p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings" className="cursor-pointer">
                <SettingsIcon className="w-4 h-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-red-600 focus:text-red-600">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

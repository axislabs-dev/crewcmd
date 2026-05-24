"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { AppTray } from "@/components/app-tray";

function isChromeHiddenRoute(pathname: string) {
  return pathname === "/" || pathname === "/access-denied" || pathname.startsWith("/invite/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isChromeHiddenRoute(pathname)) {
    return <main>{children}</main>;
  }

  return (
    <div className="app-shell min-h-screen">
      <Sidebar />
      <main className="app-main min-w-0 pb-[var(--mobile-app-bar-height)] pt-[var(--mobile-safe-top)] lg:pb-0 lg:pt-0">{children}</main>
      <AppTray />
    </div>
  );
}

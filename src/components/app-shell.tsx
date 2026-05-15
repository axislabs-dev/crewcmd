"use client";

import { Sidebar } from "@/components/sidebar";
import { AppTray } from "@/components/app-tray";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell min-h-screen">
      <Sidebar />
      <main className="app-main min-w-0 pb-[var(--mobile-app-bar-height)] pt-[var(--mobile-safe-top)] lg:pb-0 lg:pt-0">{children}</main>
      <AppTray />
    </div>
  );
}

"use client";

import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell min-h-screen">
      <Sidebar />
      <main className="app-main min-w-0 pb-[var(--mobile-app-bar-height)] lg:pb-0">{children}</main>
    </div>
  );
}

"use client";

import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell grid-bg scanlines min-h-screen">
      <Sidebar />
      <main className="app-main min-w-0 pt-[calc(4rem+env(safe-area-inset-top))] lg:pt-0">{children}</main>
    </div>
  );
}

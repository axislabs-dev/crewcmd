"use client";

import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg scanlines min-h-screen">
      <Sidebar />
      <main className="pt-16 lg:pl-[272px] lg:pt-0">{children}</main>
    </div>
  );
}

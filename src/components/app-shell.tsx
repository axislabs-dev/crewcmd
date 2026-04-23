"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

const FULLSCREEN_PATHS = new Set(["/jarvis"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullscreen = pathname ? FULLSCREEN_PATHS.has(pathname) : false;

  return (
    <div className="grid-bg scanlines min-h-screen">
      {!isFullscreen ? <Sidebar /> : null}
      <main className={isFullscreen ? "min-h-screen" : "pt-16 lg:pl-[272px] lg:pt-0"}>{children}</main>
    </div>
  );
}

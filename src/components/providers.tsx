"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { CompanyProvider } from "@/components/company-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <CompanyProvider>{children}</CompanyProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}

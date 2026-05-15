"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { CompanyProvider } from "@/components/company-context";
import { ChatEventProvider } from "@/components/chat/chat-event-provider";
import { AgentVoiceSessionProvider } from "@/components/app-tray";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <CompanyProvider>
          <AgentVoiceSessionProvider>
            <ChatEventProvider />
            {children}
          </AgentVoiceSessionProvider>
        </CompanyProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}

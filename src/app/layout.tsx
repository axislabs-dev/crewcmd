import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CrewCmd | Agent Crew Orchestration",
  description:
    "Agent crew orchestration platform for AI teams",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("crewcmd-theme")||"light";if(t==="system"){t=window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

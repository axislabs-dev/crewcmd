import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("crewcmd-theme")||"light";if(t==="system"){t=window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <div className="grid-bg scanlines min-h-screen">
            <Sidebar />
            <main className="pt-14 lg:pl-[220px] lg:pt-0">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

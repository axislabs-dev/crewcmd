"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { CompanySwitcher } from "@/components/company-switcher";

// Grouped nav structure: section → items
const navSections = [
  {
    label: null, // Top-level, no section header
    items: [
      {
        href: "/inbox",
        label: "Inbox",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h2.21a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859M12 3v8.25m0 0-3-3m3 3 3-3M2.25 18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V6a2.25 2.25 0 0 0-2.25-2.25h-15A2.25 2.25 0 0 0 2.25 6v12Z" />
          </svg>
        ),
      },
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
          </svg>
        ),
      },
      {
        href: "/chat",
        label: "Chat",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "WORK",
    items: [
      {
        href: "/tasks",
        label: "Task Board",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
        ),
      },
      {
        href: "/projects",
        label: "Projects",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
          </svg>
        ),
      },
      {
        href: "/automations",
        label: "Automations",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "AGENTS",
    items: [
      {
        href: "/agents",
        label: "All Agents",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        ),
      },
      {
        href: "/skills",
        label: "Skills",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
          </svg>
        ),
      },
      {
        href: "/blueprints",
        label: "Blueprints",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "COMPANY",
    items: [
      {
        href: "/org-chart",
        label: "Org Chart",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        ),
      },
      {
        href: "/team",
        label: "Team",
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 0H9a2 2 0 0 0-2 2v1M12 5h3a2 2 0 0 1 2 2v1M7 8H4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h3m0-4v4m10-4h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3m0-4v4M7 12v3a2 2 0 0 0 2 2h1m3 0h1a2 2 0 0 0 2-2v-3" />
          </svg>
        ),
      },
    ],
  },
];

const settingsItem = {
  href: "/dashboard/settings",
  label: "Settings",
  icon: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
};

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();

  // Hide sidebar on login page and access-denied
  if (pathname === "/" || pathname === "/access-denied") return null;
  // Hide sidebar on invite pages
  if (pathname.startsWith("/invite/")) return null;

  const role = (session?.user as Record<string, unknown> | undefined)?.role as string | undefined;
  const isSuperAdmin = role === "super_admin";

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const NavLink = ({ item, onClick }: { item: { href: string; label: string; icon: React.ReactNode }; onClick?: () => void }) => {
    const active = isActive(item.href);
    return (
      <li>
        <Link
          href={item.href}
          onClick={onClick}
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-xs tracking-wider transition-all duration-200 ${
            active
              ? "bg-neo/10 text-neo"
              : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
          }`}
          style={active ? { boxShadow: "inset 0 0 20px rgba(0, 240, 255, 0.05)" } : undefined}
        >
          {active && (
            <div
              className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-neo"
              style={{ boxShadow: "0 0 8px rgba(0, 240, 255, 0.6)" }}
            />
          )}
          <span className={`transition-colors ${active ? "text-neo" : "text-white/25 group-hover:text-white/50"}`}>
            {item.icon}
          </span>
          <span>{item.label.toUpperCase()}</span>
          {active && (
            <div
              className="ml-auto h-1.5 w-1.5 rounded-full bg-neo"
              style={{ boxShadow: "0 0 6px rgba(0, 240, 255, 0.6)" }}
            />
          )}
        </Link>
      </li>
    );
  };

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <div className="space-y-4">
      {navSections.map((section, idx) => (
        <div key={idx}>
          {section.label && (
            <div className="mb-1.5 px-3 font-mono text-[10px] font-bold tracking-[0.2em] text-white/35">
              {section.label}
            </div>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} onClick={onClick} />
            ))}
          </ul>
        </div>
      ))}
      {isSuperAdmin && (
        <div>
          <div className="mx-3 mb-1.5 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          <ul className="space-y-0.5">
            <NavLink item={settingsItem} onClick={onClick} />
          </ul>
        </div>
      )}
    </div>
  );

  const UserInfo = () => {
    if (!session?.user) return null;
    const username = (session.user as Record<string, unknown>).username as string | undefined;
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        {session.user.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt=""
            className="h-6 w-6 rounded-full border border-white/10"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] tracking-wider text-white/60">
            {session.user.name || username || "User"}
          </p>
          {role && (
            <p className="font-mono text-[9px] tracking-wider text-white/35">
              {role.toUpperCase().replace("_", " ")}
            </p>
          )}
        </div>
      </div>
    );
  };

  const SignOutButton = () => (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-[11px] tracking-wider text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/50"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
      </svg>
      SIGN OUT
    </button>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-white/[0.06] bg-bg-primary/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2.5">
          <div
            className="h-2.5 w-2.5 rounded-full bg-neo"
            style={{ boxShadow: "0 0 10px rgba(0, 240, 255, 0.5)" }}
          />
          <span className="glow-text-neo font-mono text-sm font-bold tracking-[0.15em] text-neo">
            CREWCMD
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed top-0 left-0 z-40 flex h-full w-64 flex-col border-r border-white/[0.06] bg-bg-primary/95 backdrop-blur-xl transition-transform duration-300 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-4">
          <div
            className="h-2.5 w-2.5 rounded-full bg-neo"
            style={{ boxShadow: "0 0 10px rgba(0, 240, 255, 0.5)" }}
          />
          <span className="glow-text-neo font-mono text-sm font-bold tracking-[0.15em] text-neo">
            CREWCMD
          </span>
        </div>
        <CompanySwitcher />
        <nav className="flex-1 px-3 py-4">
          <NavList onClick={() => setMobileOpen(false)} />
        </nav>
        <div className="border-t border-white/[0.04] px-3 py-3">
          <UserInfo />
          <SignOutButton />
          <span className="block px-3 pt-2 font-mono text-[11px] tracking-wider text-white/40">
            CREWCMD v0.3.0
          </span>
        </div>
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed top-0 left-0 z-30 hidden h-screen w-[220px] flex-col border-r border-white/[0.06] bg-bg-primary/80 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div
            className="h-3 w-3 rounded-full bg-neo"
            style={{ boxShadow: "0 0 12px rgba(0, 240, 255, 0.6)" }}
          />
          <div className="flex flex-col">
            <span className="glow-text-neo font-mono text-sm font-bold tracking-[0.15em] text-neo">
              CREWCMD
            </span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-white/45">
              YOUR CREW. YOUR COMMAND.
            </span>
          </div>
        </div>

        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        <CompanySwitcher />

        <nav className="flex-1 px-3 py-4">
          <NavList />
        </nav>

        <div className="border-t border-white/[0.04] px-3 py-3">
          <UserInfo />
          <SignOutButton />
          <span className="block px-3 pt-2 font-mono text-[11px] tracking-wider text-white/40">
            CREWCMD v0.3.0
          </span>
        </div>
      </aside>
    </>
  );
}

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session;

  const isAuthPage = nextUrl.pathname === "/";
  const isApi = nextUrl.pathname.startsWith("/api/");
  const isAccessDenied = nextUrl.pathname === "/access-denied";
  const isInvitePage = nextUrl.pathname.startsWith("/invite/");
  const isOnboarding = nextUrl.pathname === "/onboarding";

  // Allow all API routes through — they have their own auth (bearer tokens, sessions)
  if (isApi) return NextResponse.next();

  // Allow access-denied page
  if (isAccessDenied) return NextResponse.next();

  // Allow invite pages through (they handle their own auth)
  if (isInvitePage) return NextResponse.next();

  // Redirect logged-in users away from login page
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  // Redirect unauthenticated users to login page (protect everything except /)
  if (!isAuthPage && !isLoggedIn) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // Role-based route protection
  if (isLoggedIn && session.user) {
    const role = (session.user as Record<string, unknown>).role as string | undefined;
    const pathname = nextUrl.pathname;

    // /dashboard/settings → super_admin only
    if (pathname.startsWith("/dashboard/settings")) {
      if (role !== "super_admin") {
        return NextResponse.redirect(new URL("/dashboard", nextUrl));
      }
    }

    // viewer role: block write-oriented pages (tasks, projects creation etc are handled by API)
    // viewers can see all dashboard pages in read-only mode
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

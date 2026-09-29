import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";

/**
 * Fast, cookie-presence-only redirect for UX. This is NOT the authority on
 * whether a request is authenticated — Next.js explicitly warns that a
 * Proxy matcher change can silently stop covering a route, so every page and
 * API route re-verifies the session and permissions itself
 * (see requireSessionUser / can() in src/server/auth). Proxy only exists so
 * an unauthenticated visitor doesn't see a flash of protected UI.
 */
const PUBLIC_PATHS = ["/login", "/onboarding"];
const PUBLIC_API_PREFIXES = ["/api/health", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublicPage = PUBLIC_PATHS.includes(pathname);

  if (!hasSession && !isPublicPage && !pathname.startsWith("/api")) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!hasSession && pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

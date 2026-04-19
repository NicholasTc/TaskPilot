import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

const protectedPaths = ["/today", "/upcoming", "/insights"];
const authPaths = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  const isProtectedPath = protectedPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const isAuthPath = authPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (isProtectedPath && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath && isAuthenticated) {
    const todayUrl = new URL("/today", request.url);
    return NextResponse.redirect(todayUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/today/:path*", "/upcoming/:path*", "/insights/:path*", "/login", "/signup"],
};

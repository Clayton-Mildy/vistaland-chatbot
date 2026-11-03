import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Pages only admins may open. Sales are sent home; the server actions behind these pages check
// the role again (lib/session.ts requireAdmin), so this is navigation, not the only guard.
export const ADMIN_ONLY_PATHS = ["/stock", "/staff", "/projects", "/kpr", "/leads", "/test-chat", "/settings", "/roster"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
  if (!req.auth?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const role = req.auth.user.role;
  if (role !== "admin" && ADMIN_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
});

export const config = {
  // sw.js and the manifest are fetched by the browser itself, which must not be sent to /login.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login|sw.js|manifest.webmanifest).*)"],
};

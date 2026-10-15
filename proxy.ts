import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (the file convention formerly named `middleware`).
 *
 * It gates PAGE navigations on the presence of the session cookie and returns the documented
 * JSON envelope for unauthenticated `/api/*` calls, so an API client never receives an HTML
 * redirect in place of JSON. Cookie presence is only a cheap first filter — every API route
 * still resolves the real session through `requireUser()`.
 *
 * Authenticated users are deliberately NOT redirected away from /login or /register: a
 * still-present but expired cookie would otherwise bounce them between /login and /groups.
 */

const PUBLIC_PAGE_PATHS = new Set(["/login", "/register"]);

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("sid")?.value);

  if (hasSession) {
    return NextResponse.next();
  }

  // /login and /register are reachable without a session.
  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // API calls get the contract's error envelope, not a redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Bạn cần đăng nhập để tiếp tục." },
      },
      { status: 401 },
    );
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except the public auth endpoints, Next.js static output and static assets.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff|woff2|ttf|txt)$).*)",
  ],
};

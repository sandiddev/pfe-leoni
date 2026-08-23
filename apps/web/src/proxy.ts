import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "leoni.session_token";

/**
 * Redirects unauthenticated traffic to the login page.
 *
 * Next 16 renamed this convention from `middleware.ts` to `proxy.ts`.
 *
 * This is a convenience, not a security control: it only checks that a session
 * cookie is present, because it runs on the edge runtime and cannot
 * reach the database. The real check happens in the authenticated layout and in
 * every tRPC procedure. Its job is to spare a signed-out user a flash of an
 * empty application before being bounced.
 */
export default function proxy(request: NextRequest): NextResponse {
  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`__Secure-${SESSION_COOKIE}`);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except the login page, the API routes (which authenticate
  // themselves and must return 401 rather than a redirect) and static assets.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};

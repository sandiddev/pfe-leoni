import { type NextRequest, NextResponse } from "next/server";

import { env } from "@leoni/env/server";

const SESSION_COOKIE = "leoni.session_token";

/**
 * Two things happen on every request: a Content-Security-Policy is minted, and
 * unauthenticated traffic is sent to the login page.
 *
 * Next 16 renamed this convention from `middleware.ts` to `proxy.ts`.
 *
 * **The redirect is a convenience, not a security control.** It only checks that
 * a session cookie is present, because it runs on the edge runtime and cannot
 * reach the database. The real check happens in the authenticated layout and in
 * every tRPC procedure. Its job is to spare a signed-out user a flash of an
 * empty application before being bounced.
 *
 * **The CSP is a real control**, and it has to be minted here rather than
 * declared in `next.config.ts` because it carries a per-request nonce. Two
 * inline scripts need one: Next's own hydration bootstrap, and `ThemeScript`,
 * which must run before the first paint to avoid a light-to-dark flash. The
 * alternative to a nonce is `'unsafe-inline'`, which is a CSP that looks present
 * in a header and stops nothing.
 */

/** Paths that must never be redirected, even without a session. */
function isExempt(pathname: string): boolean {
  // API routes authenticate themselves and must answer 401 rather than serve a
  // redirect to a caller expecting JSON.
  return pathname === "/login" || pathname.startsWith("/api/");
}

/**
 * The policy, with the request's nonce.
 *
 * `'strict-dynamic'` lets a nonced script load the chunks it needs without
 * every chunk URL having to be listed — which is the only workable shape for a
 * bundler that names files by content hash.
 *
 * `'unsafe-eval'` in development only: the React refresh runtime needs it, and
 * a policy that breaks `pnpm dev` is a policy somebody deletes.
 */
function contentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // Tailwind emits a style element; there is no nonce plumbing for it, and an
    // injected stylesheet cannot exfiltrate the way a script can.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The application talks only to itself; there is no external service.
    `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Belt and braces with the X-Frame-Options header: this one is what modern
    // browsers actually enforce.
    "frame-ancestors 'none'",
  ].join("; ");
}

export default function proxy(request: NextRequest): NextResponse {
  // 16 bytes of randomness, base64. `crypto` is available on the edge runtime.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // Through `@leoni/env`, which is the only module allowed to read
  // `process.env` (CLAUDE.md section 1). The lint rule matches bracket access
  // and would not have caught `process.env.NODE_ENV` here.
  const isDevelopment = env.NODE_ENV !== "production";
  const policy = contentSecurityPolicy(nonce, isDevelopment);

  // Passed down so the layout can put the nonce on its inline script, and so
  // Next's own bootstrap picks it up.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);

  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`__Secure-${SESSION_COOKIE}`);

  const response =
    hasSession || isExempt(request.nextUrl.pathname)
      ? NextResponse.next({ request: { headers } })
      : NextResponse.redirect(new URL("/login", request.url));

  response.headers.set("content-security-policy", policy);

  return response;
}

export const config = {
  // Everything except static assets. Wider than it needs to be for the
  // redirect — `isExempt` handles those — because the CSP has to reach the
  // login page too, which is the one screen an unauthenticated stranger sees.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

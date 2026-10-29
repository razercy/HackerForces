import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content Security Policy with a fresh script nonce. Next.js
 * applies the nonce to its own scripts automatically (it reads it from the
 * request's CSP header). Pages are dynamically rendered, which nonces require.
 *
 * style-src allows 'unsafe-inline': CodeMirror injects editor styles at
 * runtime and React uses style attributes. Script execution, the main XSS
 * vector, stays nonce-only.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Pages only. Framework internals (/_next/*: static assets, images, the dev HMR websocket)
  // and API responses (JSON) do not need a document CSP, and proxying the HMR socket breaks it.
  matcher: [{ source: "/((?!api/|_next/|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};

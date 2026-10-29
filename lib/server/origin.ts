import "server-only";
import { serverEnv } from "@/lib/server/env";
import { AppError } from "@/lib/server/errors";

/**
 * CSRF defence for cookie-authenticated JSON route handlers. Browsers send an
 * Origin header on every cross-origin and same-origin POST/PUT/DELETE; a
 * request whose Origin is not this app (or that has none) is rejected.
 * Server Actions get the equivalent check from Next.js, and Better Auth
 * checks its own endpoints against `trustedOrigins`.
 */
export function assertSameOrigin(req: Request, expectedOrigin = new URL(serverEnv().BETTER_AUTH_URL).origin): void {
  const origin = req.headers.get("origin");
  if (!origin || origin !== expectedOrigin) {
    throw new AppError("FORBIDDEN", "Cross-origin request rejected", 403);
  }
}

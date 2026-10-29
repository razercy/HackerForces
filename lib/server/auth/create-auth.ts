import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "@/lib/server/db";
import * as schema from "@/lib/server/db/schema";

export type AuthOptions = { db: Db; secret: string; baseURL: string };

/** Factory so tests can build an auth instance against an isolated database. */
export function createAuth({ db, secret, baseURL }: AuthOptions) {
  return betterAuth({
    secret,
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Email verification is deferred until an email provider is configured.
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Durable, cross-instance limits (memory storage would be per serverless instance).
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 10 },
      },
    },
    trustedOrigins: [new URL(baseURL).origin],
    advanced: { useSecureCookies: baseURL.startsWith("https://") },
    // nextCookies must be the last plugin so Server Actions can set cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

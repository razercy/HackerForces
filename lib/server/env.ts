import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  JUDGE_PROVIDER: z.enum(["mock"]).default("mock"),
  /** Artificial latency so the queued → running → judged flow is visible in development. */
  MOCK_JUDGE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(1_500),
  /** Shared secret for the judge-drain cron endpoint. Optional locally. */
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Parsed lazily so that `next build` and unit
 * tests do not require secrets unless a code path actually needs them.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

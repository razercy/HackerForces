import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  JUDGE_PROVIDER: z.enum(["mock", "judge0"]).default("mock"),
  /** Base URL of the isolated Judge0 instance (HTTPS outside local development). */
  JUDGE0_URL: z.url().optional(),
  /** Shared secret Judge0 checks in X-Auth-Token (AUTHN_TOKEN in judge0.conf). */
  JUDGE0_AUTH_TOKEN: z.string().min(32).optional(),
  JUDGE0_CPP_LANGUAGE_ID: z.coerce.number().int().positive().default(54),
  /** Must not exceed MAX_STACK_LIMIT / MAX_MEMORY_LIMIT in the instance's judge0.conf (KB). Defaults = stock Judge0. */
  JUDGE0_MAX_STACK_KB: z.coerce.number().int().positive().default(128_000),
  JUDGE0_MAX_MEMORY_KB: z.coerce.number().int().positive().default(512_000),
  /** Artificial latency so the queued → running → judged flow is visible in development. */
  MOCK_JUDGE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(1_500),
  /** Shared secret for the judge-drain cron endpoint. Optional locally. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Days to keep raw editor telemetry and periodic snapshots. */
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
}).superRefine((e, ctx) => {
  if (e.JUDGE_PROVIDER !== "judge0") return;
  if (!e.JUDGE0_URL) ctx.addIssue({ code: "custom", path: ["JUDGE0_URL"], message: "Required when JUDGE_PROVIDER=judge0" });
  if (!e.JUDGE0_AUTH_TOKEN) ctx.addIssue({ code: "custom", path: ["JUDGE0_AUTH_TOKEN"], message: "Required when JUDGE_PROVIDER=judge0" });
  const local = e.JUDGE0_URL && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(e.JUDGE0_URL + "/");
  if (e.JUDGE0_URL && !e.JUDGE0_URL.startsWith("https://") && !local) {
    ctx.addIssue({ code: "custom", path: ["JUDGE0_URL"], message: "Judge0 must be reached over HTTPS (hidden tests and the auth token travel on this connection)" });
  }
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

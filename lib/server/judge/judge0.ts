import "server-only";
import { z } from "zod";
import { tokensMatch } from "./checker";
import { JudgeUnavailableError, type JudgeProvider, type JudgeRequest, type JudgeResult } from "./types";

/**
 * Adapter for a self-hosted Judge0 CE instance running on an isolated host
 * (see infra/judge). The application never executes contestant code: it
 * sends source + one test per Judge0 submission, polls for results, and
 * compares outputs itself with a token checker.
 *
 * Hidden test data is sent only to Judge0 and is never logged, stored or
 * included in errors.
 */

export type Judge0Config = {
  baseUrl: string;
  authToken: string;
  /** Judge0 language id for C++17 (54 = "C++ (GCC 9.2.0)" on Judge0 CE 1.13). */
  cppLanguageId: number;
  pollIntervalMs?: number;
  /** Max submissions per batch request (Judge0 default MAX_SUBMISSION_BATCH_SIZE is 20). */
  batchSize?: number;
  /**
   * Server-side ceilings from the instance's judge0.conf. Judge0 rejects a
   * submission (HTTP 422) whose limits exceed them, so requests are clamped.
   * Defaults are stock Judge0 CE 1.13: MAX_STACK_LIMIT=128000, MAX_MEMORY_LIMIT=512000 (KB).
   */
  maxStackKb?: number;
  maxMemoryKb?: number;
  fetch?: typeof fetch;
};

const STATUS = { IN_QUEUE: 1, PROCESSING: 2, ACCEPTED: 3, WRONG_ANSWER: 4, TLE: 5, COMPILE_ERROR: 6, INTERNAL_ERROR: 13, EXEC_FORMAT_ERROR: 14 } as const;
const isRuntimeError = (id: number) => id >= 7 && id <= 12;
const MAX_COMPILE_OUTPUT = 8_000;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

const tokensSchema = z.array(z.object({ token: z.string().min(1) }));
const resultSchema = z.object({
  submissions: z.array(
    z.object({
      token: z.string(),
      status: z.object({ id: z.number().int() }),
      time: z.union([z.string(), z.number()]).nullable().optional(),
      memory: z.number().nullable().optional(),
      stdout: z.string().nullable().optional(),
      compile_output: z.string().nullable().optional(),
    }),
  ),
});

type Judge0Result = z.infer<typeof resultSchema>["submissions"][number];

export class Judge0Judge implements JudgeProvider {
  readonly name = "judge0";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: Judge0Config) {
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  private async call(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.cfg.baseUrl), {
        ...init,
        signal,
        headers: { "Content-Type": "application/json", "X-Auth-Token": this.cfg.authToken, ...(init.headers ?? {}) },
      });
    } catch (err) {
      // Network error or abort. Never include request bodies (they contain hidden tests).
      throw new JudgeUnavailableError(`Judge0 unreachable: ${err instanceof Error ? err.name : "error"}`, { cause: err });
    }
    if (res.status === 401 || res.status === 403) throw new JudgeUnavailableError(`Judge0 rejected credentials (${res.status})`);
    if (res.status === 422) {
      // Validation errors name the offending parameters (e.g. a limit above the server's cap).
      // Report only the field names: never echo bodies, which may relate to hidden tests.
      const body: unknown = await res.json().catch(() => null);
      const fields = new Set<string>();
      for (const item of Array.isArray(body) ? body : [body]) if (item && typeof item === "object") Object.keys(item).forEach((k) => fields.add(k));
      throw new JudgeUnavailableError(`Judge0 rejected parameters (422): ${[...fields].slice(0, 10).join(", ") || "unknown"}`);
    }
    if (!res.ok) throw new JudgeUnavailableError(`Judge0 HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (err) {
      throw new JudgeUnavailableError("Judge0 returned invalid JSON", { cause: err });
    }
  }

  async judge(req: JudgeRequest, { signal }: { signal: AbortSignal }): Promise<JudgeResult> {
    if (req.language !== "cpp17") throw new JudgeUnavailableError(`Unsupported language ${req.language}`);
    const total = req.tests.length;
    if (total === 0) throw new JudgeUnavailableError("Problem has no tests");

    const cpuSeconds = req.timeLimitMs / 1000;
    // Clamp to the instance's caps; a problem limit above them would otherwise be rejected outright.
    const memLimitKb = Math.min(req.memoryLimitMb * 1024, this.cfg.maxMemoryKb ?? 512_000);
    const limits = {
      language_id: this.cfg.cppLanguageId,
      compiler_options: "-std=c++17 -O2 -pipe",
      cpu_time_limit: cpuSeconds,
      cpu_extra_time: Math.min(0.5, cpuSeconds / 2),
      wall_time_limit: Math.min(20, cpuSeconds * 3 + 1),
      memory_limit: memLimitKb,
      stack_limit: Math.min(memLimitKb, this.cfg.maxStackKb ?? 128_000),
      // Judge0 runs the binary via a shell wrapper inside isolate, so a single-process limit would break every run.
      max_processes_and_or_threads: 4,
      enable_per_process_and_thread_time_limit: false,
      enable_per_process_and_thread_memory_limit: false,
      max_file_size: 1024,
      enable_network: false,
      redirect_stderr_to_stdout: false,
    };

    // 1) Create one Judge0 submission per test, in batches.
    const batchSize = this.cfg.batchSize ?? 20;
    const tokens: string[] = [];
    for (let i = 0; i < total; i += batchSize) {
      const chunk = req.tests.slice(i, i + batchSize);
      const body = { submissions: chunk.map((t) => ({ ...limits, source_code: b64(req.source), stdin: b64(t.input) })) };
      const created = tokensSchema.safeParse(await this.call("/submissions/batch?base64_encoded=true", { method: "POST", body: JSON.stringify(body) }, signal));
      if (!created.success || created.data.length !== chunk.length) throw new JudgeUnavailableError("Judge0 batch create returned an unexpected response");
      tokens.push(...created.data.map((d) => d.token));
    }

    // 2) Poll until every test has a final status (bounded by the caller's signal).
    const results = new Map<string, Judge0Result>();
    const fields = "token,status,time,memory,stdout,compile_output";
    while (results.size < tokens.length) {
      signal.throwIfAborted();
      const pending = tokens.filter((t) => !results.has(t));
      for (let i = 0; i < pending.length; i += batchSize) {
        const chunk = pending.slice(i, i + batchSize);
        const got = resultSchema.safeParse(await this.call(`/submissions/batch?tokens=${chunk.join(",")}&base64_encoded=true&fields=${fields}`, { method: "GET" }, signal));
        if (!got.success) throw new JudgeUnavailableError("Judge0 batch get returned an unexpected response");
        for (const r of got.data.submissions) {
          if (r.status.id === STATUS.IN_QUEUE || r.status.id === STATUS.PROCESSING) continue;
          if (r.status.id === STATUS.INTERNAL_ERROR || r.status.id === STATUS.EXEC_FORMAT_ERROR) throw new JudgeUnavailableError(`Judge0 internal status ${r.status.id}`);
          results.set(r.token, r);
        }
      }
      if (results.size < tokens.length) await sleep(this.cfg.pollIntervalMs ?? 500, signal);
    }

    // 3) Verdict: the first failing test in ordinal order decides, like a sequential judge.
    let timeMs = 0;
    let memoryKb = 0;
    for (let i = 0; i < total; i++) {
      const r = results.get(tokens[i]!)!;
      const test = req.tests[i]!;
      if (r.status.id === STATUS.COMPILE_ERROR) {
        return { verdict: "compilation_error", timeMs: null, memoryKb: null, passedTests: 0, totalTests: 0, failedTest: null, compileOutput: unb64(r.compile_output).slice(0, MAX_COMPILE_OUTPUT) || "Compilation failed" };
      }
      const t = Math.round(Number(r.time ?? 0) * 1000);
      const m = Math.round(Number(r.memory ?? 0));
      timeMs = Math.max(timeMs, t);
      memoryKb = Math.max(memoryKb, m);
      const fail = (verdict: JudgeResult["verdict"]): JudgeResult => ({ verdict, timeMs, memoryKb, passedTests: i, totalTests: total, failedTest: test.ordinal, compileOutput: null });
      if (r.status.id === STATUS.TLE) return fail("time_limit_exceeded");
      if (isRuntimeError(r.status.id)) {
        // Judge0 reports memory-limit kills as runtime errors; classify by usage near the limit.
        return fail(m >= memLimitKb * 0.95 ? "memory_limit_exceeded" : "runtime_error");
      }
      if (r.status.id !== STATUS.ACCEPTED && r.status.id !== STATUS.WRONG_ANSWER) throw new JudgeUnavailableError(`Judge0 unexpected status ${r.status.id}`);
      if (!tokensMatch(unb64(r.stdout), test.expectedOutput)) return fail("wrong_answer");
    }
    return { verdict: "accepted", timeMs, memoryKb, passedTests: total, totalTests: total, failedTest: null, compileOutput: null };
  }

  /** Reachability + credentials check for the health/ops pages. Reveals nothing else. */
  async ping(signal: AbortSignal): Promise<boolean> {
    try {
      await this.call("/about", { method: "GET" }, signal);
      return true;
    } catch {
      return false;
    }
  }
}

// The listener is removed after each sleep: one long judgement polls many times on the same signal.
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new JudgeUnavailableError("Judging timed out"));
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

import type { Language } from "@/lib/languages";
import type { Verdict } from "@/lib/submissions";

export type JudgeTest = { ordinal: number; input: string; expectedOutput: string };

export type JudgeRequest = {
  submissionId: string;
  language: Language;
  source: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: JudgeTest[];
};

export type JudgeResult = {
  verdict: Verdict;
  /** Max over executed tests. Null when nothing ran (e.g. compilation error). */
  timeMs: number | null;
  memoryKb: number | null;
  passedTests: number;
  totalTests: number;
  /** Ordinal of the first failing test, if any. */
  failedTest: number | null;
  /** Compiler diagnostics, shown to the contestant. Providers must not include test data. */
  compileOutput: string | null;
};

/**
 * Provider-independent judging boundary. Implementations either judge in a
 * safe simulation (mock) or forward to an isolated external sandbox. No
 * implementation may execute contestant code inside this application process.
 *
 * `judge` must settle before `signal` aborts; the worker sizes the signal to
 * fit inside its lease and the function's max duration.
 */
export interface JudgeProvider {
  readonly name: string;
  judge(request: JudgeRequest, opts: { signal: AbortSignal }): Promise<JudgeResult>;
}

/** Thrown for infrastructure failures (judge unreachable, malformed response). Retried by the worker. */
export class JudgeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JudgeUnavailableError";
  }
}

import { createHash } from "node:crypto";
import { VERDICTS, type Verdict } from "@/lib/submissions";
import { JudgeUnavailableError, type JudgeProvider, type JudgeRequest, type JudgeResult } from "./types";

/**
 * Development judge. It NEVER compiles or runs the submitted program: the
 * verdict is derived deterministically from the source text, so the whole
 * submission pipeline can be exercised locally and in tests without an
 * execution sandbox.
 *
 * Rules, in order:
 *  1. A directive comment forces a verdict:
 *       // @mock-verdict wrong_answer test=3
 *       // @mock-verdict compilation_error
 *       // @mock-verdict judge_unavailable        (simulates infrastructure failure)
 *  2. Source without a `main(` → compilation_error with a gcc-like message.
 *  3. Otherwise → accepted.
 * Time and memory are pseudo-random but stable per source (seeded by its hash).
 */
export class MockJudge implements JudgeProvider {
  readonly name = "mock";

  constructor(private readonly delayMs = 0) {}

  async judge(req: JudgeRequest, { signal }: { signal: AbortSignal }): Promise<JudgeResult> {
    if (this.delayMs > 0) await sleep(this.delayMs, signal);
    signal.throwIfAborted();

    const total = req.tests.length;
    const seed = createHash("sha256").update(req.source).digest();
    const timeMs = Math.min(req.timeLimitMs - 1, 15 + (seed.readUInt16BE(0) % 200));
    const memoryKb = 3_000 + (seed.readUInt16BE(2) % 8_000);

    const directive = /@mock-verdict\s+([a-z_]+)(?:\s+test=(\d+))?/.exec(req.source);
    if (directive?.[1] === "judge_unavailable") throw new JudgeUnavailableError("Mock judge unavailable (directive)");

    if (directive && (VERDICTS as readonly string[]).includes(directive[1]!)) {
      const v = directive[1] as Verdict;
      if (v === "accepted") return ok(total, timeMs, memoryKb);
      if (v === "compilation_error") return compileError("main.cpp:1:1: error: mock compilation error (forced by directive)");
      const failedTest = Math.min(Math.max(1, Number(directive[2] ?? 1)), Math.max(total, 1));
      return {
        verdict: v,
        timeMs: v === "time_limit_exceeded" ? req.timeLimitMs : timeMs,
        memoryKb: v === "memory_limit_exceeded" ? req.memoryLimitMb * 1024 : memoryKb,
        passedTests: failedTest - 1,
        totalTests: total,
        failedTest,
        compileOutput: null,
      };
    }

    if (!/\bmain\s*\(/.test(req.source)) {
      return compileError("/usr/bin/ld: in function `_start': undefined reference to `main'\ncollect2: error: ld returned 1 exit status");
    }
    return ok(total, timeMs, memoryKb);
  }
}

const ok = (total: number, timeMs: number, memoryKb: number): JudgeResult => ({
  verdict: "accepted",
  timeMs,
  memoryKb,
  passedTests: total,
  totalTests: total,
  failedTest: null,
  compileOutput: null,
});

const compileError = (compileOutput: string): JudgeResult => ({
  verdict: "compilation_error",
  timeMs: null,
  memoryKb: null,
  passedTests: 0,
  totalTests: 0,
  failedTest: null,
  compileOutput,
});

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}

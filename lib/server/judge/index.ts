import "server-only";
import { serverEnv } from "@/lib/server/env";
import { MockJudge } from "./mock";
import type { JudgeProvider } from "./types";

export type { JudgeProvider, JudgeRequest, JudgeResult } from "./types";

let provider: JudgeProvider | undefined;

/** The configured judge. Only the mock exists until the sandboxed judge lands (Phase 7). */
export function getJudge(): JudgeProvider {
  if (provider) return provider;
  const env = serverEnv();
  switch (env.JUDGE_PROVIDER) {
    case "mock":
      provider = new MockJudge(env.MOCK_JUDGE_DELAY_MS);
      return provider;
  }
}

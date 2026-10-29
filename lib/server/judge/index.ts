import "server-only";
import { serverEnv } from "@/lib/server/env";
import { Judge0Judge } from "./judge0";
import { MockJudge } from "./mock";
import type { JudgeProvider } from "./types";

export type { JudgeProvider, JudgeRequest, JudgeResult } from "./types";

let provider: JudgeProvider | undefined;

/** The configured judge: the safe mock (default) or an isolated Judge0 instance. */
export function getJudge(): JudgeProvider {
  if (provider) return provider;
  const env = serverEnv();
  switch (env.JUDGE_PROVIDER) {
    case "mock":
      provider = new MockJudge(env.MOCK_JUDGE_DELAY_MS);
      return provider;
    case "judge0":
      // serverEnv() guarantees URL and token are present for this provider.
      provider = new Judge0Judge({
        baseUrl: env.JUDGE0_URL!,
        authToken: env.JUDGE0_AUTH_TOKEN!,
        cppLanguageId: env.JUDGE0_CPP_LANGUAGE_ID,
        maxStackKb: env.JUDGE0_MAX_STACK_KB,
        maxMemoryKb: env.JUDGE0_MAX_MEMORY_KB,
      });
      return provider;
  }
}

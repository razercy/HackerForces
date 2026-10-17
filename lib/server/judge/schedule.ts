import "server-only";
import { after } from "next/server";
import { getDb } from "@/lib/server/db";
import { getJudge } from "./index";
import { drainJobs } from "./worker";

/**
 * Drain the judge queue after the response is sent. This is only a
 * latency optimisation: correctness never depends on it, because jobs are
 * durable and any later status poll or the cron endpoint picks them up.
 * Budget: 20 s of claims + 45 s judge timeout fits the route's maxDuration (60–300 s).
 */
export function scheduleDrain(): void {
  after(async () => {
    try {
      await drainJobs(getDb(), getJudge(), { maxJobs: 5, budgetMs: 20_000 });
    } catch (err) {
      console.error("judge drain failed", err);
    }
  });
}

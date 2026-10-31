// SYNTHETIC DATA ONLY. Builds a finished demo contest whose integrity data comes
// from labelled scenarios played through the real services (telemetry ingestion,
// judging with the mock judge, feature extraction, scoring, review). Used by
// `npm run seed:demo` on development databases; never by the running application.

import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { contest, problem, reviewCase } from "@/lib/server/db/schema";
import { drainAnalysisJobs, enqueueEndedContests } from "@/lib/server/integrity/pipeline";
import { listLatestAssessments } from "@/lib/server/integrity/review";
import { MockJudge } from "@/lib/server/judge/mock";
import { drainJobs } from "@/lib/server/judge/worker";
import { addNote, confirmDecision, openCaseManually, recordDecision, submitResponse } from "@/lib/server/review/cases";
import { attachProblem, createContest, publishContest, registerForContest } from "@/lib/server/services/contests";
import { addExample, addTest, createProblem, setReferenceSolution } from "@/lib/server/services/problems";
import type { Principal } from "@/lib/server/services/roles";
import { createSubmission } from "@/lib/server/services/submissions";
import { addSnippet, createTemplate } from "@/lib/server/services/templates";
import { ingestBatch, startSession } from "@/lib/server/telemetry/ingest";
import { TELEMETRY_SCHEMA_VERSION } from "@/lib/telemetry/events";
import { TELEMETRY_NOTICE_VERSION } from "@/lib/telemetry/notice";
import { TimelineBuilder, rng } from "./builder";
import { PROBLEMS, TEMPLATES, solutionOf, type TemplateName } from "./corpus";
import { SCENARIO_BY_ID, type Profile } from "./scenarios";

export const DEMO_CONTEST_SLUG = "integrity-demo";
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Problems from the synthetic corpus, with statements written for the demo. */
const DEMO_PROBLEMS = [
  {
    corpusId: "p-kadane",
    label: "A",
    input: {
      slug: "integrity-demo-max-subarray",
      title: "Best Streak",
      statement: "Given an array of `n` integers, find the largest possible sum of a non-empty contiguous subarray.",
      inputFormat: "The first line contains `n`. The second line contains `n` integers `a_1 … a_n`.",
      outputFormat: "Print the maximum subarray sum.",
      constraints: "- `1 ≤ n ≤ 2·10^5`\n- `|a_i| ≤ 10^9`",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      difficulty: 1200,
      tags: ["dp", "greedy"],
      templateNotes: "A fast-I/O header plus a short loop is the expected shape.",
    },
    example: { input: "5\n-2 1 -3 4 -1\n", output: "4\n" },
    tests: [
      ["5\n-2 1 -3 4 -1\n", "4\n"],
      ["3\n-5 -2 -7\n", "-2\n"],
      ["4\n1 2 3 4\n", "10\n"],
    ],
  },
  {
    corpusId: "p-components",
    label: "B",
    input: {
      slug: "integrity-demo-components",
      title: "Island Count",
      statement: "A map has `n` islands and `m` bridges. Each bridge connects two islands. Count the groups of islands connected by bridges.",
      inputFormat: "The first line contains `n` and `m`. Each of the next `m` lines contains two islands `u v` (1-indexed).",
      outputFormat: "Print the number of connected groups.",
      constraints: "- `1 ≤ n ≤ 2·10^5`\n- `0 ≤ m ≤ 2·10^5`",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      difficulty: 1500,
      tags: ["dsu", "graphs"],
      templateNotes: "A disjoint-set union is the standard tool; registered DSU templates are expected.",
    },
    example: { input: "4 2\n1 2\n3 4\n", output: "2\n" },
    tests: [
      ["4 2\n1 2\n3 4\n", "2\n"],
      ["5 0\n", "5\n"],
      ["3 3\n1 2\n2 3\n3 1\n", "1\n"],
    ],
  },
] as const;

type CastMember = {
  /** Scenario id per problem label. Misconduct scenarios are *simulated*. */
  plays: { A: string; B: string };
  registered: TemplateName[];
  library?: boolean;
};

/**
 * Twelve synthetic contestants (cohort scoring needs at least ten peers). Most
 * behave legitimately; four have outcomes the review demo walks through.
 */
export const CAST: CastMember[] = [
  { plays: { A: "L_typed", B: "L_templates" }, registered: ["fastio", "dsu"] },
  { plays: { A: "L_fast", B: "L_typed" }, registered: [] },
  { plays: { A: "L_debug", B: "L_debug" }, registered: [] },
  { plays: { A: "L_autocomplete", B: "L_templates" }, registered: ["fastio", "dsu"] },
  { plays: { A: "L_reading", B: "L_typed" }, registered: [] },
  { plays: { A: "L_typed", B: "L_snippets" }, registered: [] },
  { plays: { A: "L_typed", B: "L_library" }, registered: ["fastio", "dsu"], library: true },
  // Hard negative: legitimate offline drafting that looks like a paste. Reviewed as inconclusive.
  { plays: { A: "L_offline_draft", B: "L_typed" }, registered: [] },
  // Simulated misconduct, confirmed by two people; the contestant responded.
  { plays: { A: "M_paste_all", B: "L_typed" }, registered: [] },
  // Simulated misconduct: a reviewer's decision awaits the second (admin) confirmation.
  { plays: { A: "L_typed", B: "M_robotic" }, registered: [] },
  // Simulated misconduct: case left open for a live review.
  { plays: { A: "M_inject", B: "L_fast" }, registered: [] },
  { plays: { A: "L_reading", B: "L_autocomplete" }, registered: [] },
];

export const castEmail = (i: number) => `synthetic-${String(i + 1).padStart(2, "0")}@demo.test`;
export const castName = (i: number) => `Synthetic Contestant ${String(i + 1).padStart(2, "0")}`;

/**
 * Groups wire events the way the client recorder sends them: it flushes every few seconds
 * (or every 100 events), so the server receives each event shortly after it happened.
 * Uses 20-second windows to keep the number of requests down; well inside the skew threshold.
 */
function flushes(wire: Record<string, unknown>[]) {
  const out: { events: Record<string, unknown>[]; arrivedAt: Date }[] = [];
  let batch: Record<string, unknown>[] = [];
  const close = () => {
    if (batch.length) out.push({ events: batch, arrivedAt: new Date((batch.at(-1)!.t as number) + 1_500) });
    batch = [];
  };
  for (const e of wire) {
    if (batch.length && ((e.t as number) - (batch[0]!.t as number) > 20_000 || batch.length >= 100)) close();
    batch.push(e);
  }
  close();
  return out;
}

export type DemoActors = { setter: Principal; reviewer: Principal; admin: Principal; contestants: Principal[] };
export type DemoResult = { contestId: string; slug: string; created: boolean };

const ACK = { noticeVersion: TELEMETRY_NOTICE_VERSION };

/**
 * Creates the demo contest once. Contest data is append-only by design, so an
 * existing demo contest is left untouched (re-seed on a fresh branch instead).
 */
export async function seedIntegrityDemo(db: Db, actors: DemoActors, { now = new Date(), log = (_: string) => {} } = {}): Promise<DemoResult> {
  if (actors.contestants.length !== CAST.length) throw new Error(`Expected ${CAST.length} contestants`);
  const [existing] = await db.select({ id: contest.id }).from(contest).where(eq(contest.slug, DEMO_CONTEST_SLUG));
  if (existing) return { contestId: existing.id, slug: DEMO_CONTEST_SLUG, created: false };

  const { setter, contestants } = actors;
  // A finished contest: 4 hours long, ended an hour ago. Everything below happens in the past.
  const startsAt = new Date(now.getTime() - 5 * HOUR);
  const endsAt = new Date(now.getTime() - HOUR);
  const before = new Date(startsAt.getTime() - 24 * HOUR);

  const problemIds: Record<string, string> = {};
  for (const p of DEMO_PROBLEMS) {
    const [prior] = await db.select({ id: problem.id }).from(problem).where(eq(problem.slug, p.input.slug));
    if (prior) {
      // Left by an interrupted run; problems are only attached below, so reusing them is safe.
      problemIds[p.label] = prior.id;
      continue;
    }
    const { id } = await createProblem(db, setter, p.input);
    await addExample(db, setter, id, p.example);
    for (const [input, expectedOutput] of p.tests) await addTest(db, setter, id, { input, expectedOutput });
    await setReferenceSolution(db, setter, id, { language: "cpp17", source: solutionOf(PROBLEMS.find((c) => c.id === p.corpusId)!) });
    problemIds[p.label] = id;
  }
  const { id: contestId } = await createContest(db, setter, {
    slug: DEMO_CONTEST_SLUG,
    title: "Integrity Demo Round (synthetic)",
    description: "A finished contest generated from labelled synthetic scenarios. Every contestant, session and decision here is simulated.",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  });
  for (const p of DEMO_PROBLEMS) await attachProblem(db, setter, contestId, { problemId: problemIds[p.label], label: p.label }, { now: before });
  await addSnippet(db, setter, contestId, { name: "Fast I/O header", source: TEMPLATES.fastio }, { now: before });
  await publishContest(db, setter, contestId, { now: before });
  log("created contest and problems");

  // Build every timeline first: personal templates must exist (and freeze) before the contest starts.
  const judge = new MockJudge(0);
  const plans = CAST.map((member, i) => {
    const rand = rng(1000 + i);
    const profile: Profile = {
      style: { meanMs: 120 + rand() * 140, jitter: 0.35 + rand() * 0.5, typoRate: 0.01 + rand() * 0.03, pauseRate: 0.01 + rand() * 0.02 },
      registered: member.registered,
      libraryFor: new Set(member.library ? ["p-components"] : []),
    };
    let t = startsAt.getTime() + (5 + Math.floor(rand() * 30)) * MIN;
    const sessions = DEMO_PROBLEMS.map((p) => {
      const scenario = SCENARIO_BY_ID.get(member.plays[p.label])!;
      const b = new TimelineBuilder(`pending-${i}-${p.label}`, new Date(t), 2000 + i * 10 + p.label.charCodeAt(0));
      const result = scenario.build({ b, p: PROBLEMS.find((c) => c.id === p.corpusId)!, profile, rand: b.rand });
      const submitSeq = b.submitMarker();
      t = b.now.getTime() + (3 + Math.floor(rand() * 10)) * MIN;
      return { label: p.label, b, submitSeq, result };
    });
    return { contestant: contestants[i]!, sessions };
  });
  const lastActivity = Math.max(...plans.flatMap((p) => p.sessions.map((s) => s.b.now.getTime())));
  if (lastActivity + 10 * MIN > endsAt.getTime()) throw new Error("Demo timelines do not fit inside the contest window");

  for (const { contestant, sessions } of plans) {
    const seen = new Set<string>();
    for (const t of sessions.flatMap((s) => s.result.personalTemplates)) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      await createTemplate(db, contestant, t, { now: before });
    }
    await registerForContest(db, contestant, contestId, ACK, { now: new Date(startsAt.getTime() - HOUR) });
  }
  log("registered contestants and their templates");

  for (const [i, { contestant, sessions }] of plans.entries()) {
    for (const { label, b, submitSeq, result } of sessions) {
      const { sessionId } = await startSession(db, contestant, { contestSlug: DEMO_CONTEST_SLUG, label, clientStartedAt: b.startedAt.getTime() }, { now: b.startedAt });
      for (const { events, arrivedAt } of flushes(b.wireEvents())) {
        await ingestBatch(db, contestant, { sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events }, { now: arrivedAt });
      }
      // Earlier attempts first (the mock judge reads verdict directives), then the final accepted submission.
      let at = b.now.getTime() + 2_000;
      const submit = async (raw: Record<string, unknown>) => {
        const when = new Date(at);
        await createSubmission(db, contestant, DEMO_CONTEST_SLUG, { label, language: "cpp17", ...raw }, { now: when });
        await drainJobs(db, judge, { clock: () => when });
        at += 30_000;
      };
      for (const kind of result.priorAttempts) {
        if (kind === "sample_run") await submit({ kind: "sample_run", source: b.source, ideSessionId: sessionId });
        else await submit({ source: `${b.source}\n// @mock-verdict ${kind}${kind === "wrong_answer" ? " test=2" : ""}\n`, ideSessionId: sessionId });
      }
      await submit({ source: b.source, ideSessionId: sessionId, ideSeq: submitSeq });
    }
    log(`played ${castName(i)}`);
  }

  // Live scoring as submissions were judged, then the post-contest re-score (the daily cron in
  // production): early subjects were first scored against too few peers for cohort mode.
  const analysedAt = new Date(endsAt.getTime() + 5 * MIN);
  await drainAnalysisJobs(db, { maxJobs: 100, clock: () => analysedAt });
  const rescoredAt = new Date(analysedAt.getTime() + MIN);
  await enqueueEndedContests(db, { now: rescoredAt });
  await drainAnalysisJobs(db, { maxJobs: 100, clock: () => rescoredAt });
  log("scored and re-scored all assessments");

  await stageReviews(db, actors, contestId, problemIds, endsAt);
  log("staged review cases");
  return { contestId, slug: DEMO_CONTEST_SLUG, created: true };
}

/** Puts four cases into the states the demo walks through. */
async function stageReviews(db: Db, { reviewer, admin, contestants }: DemoActors, contestId: string, problemIds: Record<string, string>, endsAt: Date) {
  const at = (minutes: number) => new Date(endsAt.getTime() + minutes * MIN);
  const caseFor = async (i: number, label: "A" | "B", minute: number) => {
    const who = contestants[i]!;
    const assessment = (await listLatestAssessments(db, reviewer, { contestSlug: DEMO_CONTEST_SLUG, userId: who.userId })).find((r) => r.label === label);
    if (!assessment) throw new Error(`No assessment for ${castName(i)} on ${label}`);
    const [open] = await db
      .select({ id: reviewCase.id })
      .from(reviewCase)
      .where(and(eq(reviewCase.userId, who.userId), eq(reviewCase.contestId, contestId), eq(reviewCase.problemId, problemIds[label]!)));
    // Elevated assessments open cases automatically; open one manually if the score stayed typical.
    return { caseId: open?.id ?? (await openCaseManually(db, reviewer, assessment.id, { now: at(minute) })).id, assessmentId: assessment.id };
  };

  const offline = await caseFor(7, "A", 10);
  await recordDecision(
    db,
    reviewer,
    offline.caseId,
    { outcome: "inconclusive", rationale: "One large paste after a long absence, but the contestant has a history of drafting offline and the code style matches their other work.", assessmentId: offline.assessmentId },
    { now: at(12) },
  );

  const pasted = await caseFor(8, "A", 14);
  await addNote(db, reviewer, pasted.caseId, "The editor lost focus for over a minute, then the full solution arrived in one paste. No registered template matches it.", { now: at(15) });
  await recordDecision(
    db,
    reviewer,
    pasted.caseId,
    { outcome: "confirmed_violation", rationale: "The whole solution was inserted in one paste after the editor lost focus, with no matching template or snippet.", assessmentId: pasted.assessmentId },
    { now: at(18) },
  );
  await confirmDecision(db, admin, pasted.caseId, { verdict: "confirmed", rationale: "Reviewed the timeline and the diff; I agree with the evidence." }, { now: at(25) });
  await submitResponse(db, contestants[8]!, pasted.caseId, "I wrote this solution in my own editor during the contest and pasted it in. I understand this breaks the contest rules.", { now: at(40) });

  // The baseline scorer rates this auto-typer as typical (a known limitation: rhythm carries little
  // weight). A reviewer browsing all assessments opened it by hand; scores are prompts, not verdicts.
  const robotic = await caseFor(9, "B", 20);
  await addNote(db, reviewer, robotic.caseId, "Opened by hand: the score is typical, but the keystroke rhythm in the timeline is unusually even.", { now: at(21) });
  await recordDecision(
    db,
    reviewer,
    robotic.caseId,
    { outcome: "confirmed_violation", rationale: "Every character arrived at an almost constant 60-90 ms rhythm with no corrections, consistent with an auto-typer.", assessmentId: robotic.assessmentId },
    { now: at(22) },
  );

  const injected = await caseFor(10, "A", 26);
  await addNote(db, reviewer, injected.caseId, "Large insertions without any user-input annotation. Check the data-quality warnings before deciding.", { now: at(27) });
}

import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/auth/roles";
import type { Db } from "@/lib/server/db";
import { codeSnapshot, contest, contestProblem, ideSession, problem, submission, telemetryEvent, user } from "@/lib/server/db/schema";
import { forbidden, notFound } from "@/lib/server/errors";
import type { Principal } from "@/lib/server/services/roles";
import { isUuid } from "@/lib/validation/ids";
import { analyzeSessionQuality } from "@/lib/telemetry/quality";

/**
 * Reviewer-only reconstruction of one editor session: ordered events,
 * code snapshots, the submissions made from it, summary counts and
 * data-quality warnings. Contestants and problem setters cannot call this.
 */
export async function getSessionTimeline(db: Db, viewer: Principal, sessionId: string) {
  if (!hasPermission(viewer.roles, "integrity:review")) throw forbidden();
  if (!isUuid(sessionId)) throw notFound("Session");

  const [s] = await db
    .select({
      session: ideSession,
      userName: user.name,
      contestSlug: contest.slug,
      contestTitle: contest.title,
      problemTitle: problem.title,
      label: contestProblem.label,
    })
    .from(ideSession)
    .innerJoin(user, eq(user.id, ideSession.userId))
    .innerJoin(contest, eq(contest.id, ideSession.contestId))
    .innerJoin(problem, eq(problem.id, ideSession.problemId))
    .leftJoin(contestProblem, and(eq(contestProblem.contestId, ideSession.contestId), eq(contestProblem.problemId, ideSession.problemId)))
    .where(eq(ideSession.id, sessionId));
  if (!s) throw notFound("Session");

  const [events, snapshots, subs] = await Promise.all([
    db.select().from(telemetryEvent).where(eq(telemetryEvent.sessionId, sessionId)).orderBy(asc(telemetryEvent.seq)),
    db.select().from(codeSnapshot).where(eq(codeSnapshot.sessionId, sessionId)).orderBy(asc(codeSnapshot.seq)),
    db
      .select({
        id: submission.id,
        kind: submission.kind,
        createdAt: submission.createdAt,
        ideSeq: submission.ideSeq,
        sourceSha256: submission.sourceSha256,
        status: submission.status,
        verdict: submission.verdict,
      })
      .from(submission)
      .where(eq(submission.ideSessionId, sessionId))
      .orderBy(asc(submission.createdAt)),
  ]);

  const reasonBySeq = new Map(events.filter((e) => e.type === "snapshot").map((e) => [e.seq, String(e.payload.reason ?? "")]));
  const warnings = analyzeSessionQuality({
    events,
    maxSeq: s.session.maxSeq,
    snapshots: snapshots.map((x) => ({ seq: x.seq, sourceSha256: x.sourceSha256, reason: reasonBySeq.get(x.seq) ?? null })),
    submissions: subs,
    purged: !!s.session.purgedAt,
  });

  const edits = events.filter((e) => e.type === "edit");
  const sum = (origin: string) => edits.filter((e) => e.payload.origin === origin).reduce((n, e) => n + Number(e.payload.inserted ?? 0), 0);
  const summary = {
    events: events.length,
    edits: edits.length,
    typedChars: sum("input.type"),
    pastedChars: sum("input.paste"),
    droppedChars: sum("input.drop"),
    pasteCount: edits.filter((e) => e.payload.origin === "input.paste").length,
    undoCount: edits.filter((e) => e.payload.origin === "undo").length,
    runs: events.filter((e) => e.type === "run").length,
    submits: events.filter((e) => e.type === "submit").length,
    snapshots: snapshots.length,
  };

  return {
    session: { ...s.session, userName: s.userName, contestSlug: s.contestSlug, contestTitle: s.contestTitle, problemTitle: s.problemTitle, label: s.label },
    events: events.map((e) => ({ seq: e.seq, type: e.type, clientTs: e.clientTs, receivedAt: e.receivedAt, payload: e.payload })),
    snapshots: snapshots.map((x) => ({ seq: x.seq, source: x.source, sourceSha256: x.sourceSha256, reason: reasonBySeq.get(x.seq) ?? null })),
    submissions: subs,
    summary,
    warnings,
  };
}

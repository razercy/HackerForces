// SYNTHETIC DATA ONLY. Builds editor sessions the way the client recorder
// emits them, for tests and the labelled evaluation scenarios. Nothing here
// is used by the running application.

import { createHash } from "node:crypto";
import type { AnalysisEvent, AnalysisSession, AnalysisSubmission } from "@/lib/integrity/features";

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TypingStyle = { meanMs: number; jitter: number; typoRate: number; pauseRate: number };
export const DEFAULT_STYLE: TypingStyle = { meanMs: 170, jitter: 0.6, typoRate: 0.03, pauseRate: 0.02 };

export class TimelineBuilder {
  private seq = 0;
  private t: number;
  private doc = "";
  readonly events: AnalysisEvent[] = [];
  private readonly snapshotSources = new Map<number, string>();
  readonly rand: () => number;

  constructor(
    readonly sessionId: string,
    readonly startedAt: Date,
    seed = 1,
  ) {
    this.t = startedAt.getTime();
    this.rand = rng(seed);
    this.push("session_start", { docLength: 0, restoredDraft: false });
  }

  private push(type: string, payload: Record<string, unknown>) {
    this.events.push({ seq: this.seq, type, clientTs: new Date(this.t), receivedAt: new Date(this.t + 1500), arrival: this.seq, payload });
    this.seq++;
  }

  private edit(origin: string, text: string, deleted = 0) {
    this.doc = this.doc.slice(0, this.doc.length - deleted) + text;
    this.push("edit", { origin, changes: 1, from: Math.max(0, this.doc.length - text.length), inserted: text.length, deleted, insertedLines: text.split("\n").length - 1, docLength: this.doc.length });
  }

  wait(ms: number) {
    this.t += ms;
    return this;
  }

  /** Human-like typing: one event per character, jittered intervals, pauses and typos. */
  type(text: string, style: Partial<TypingStyle> = {}) {
    const { meanMs, jitter, typoRate, pauseRate } = { ...DEFAULT_STYLE, ...style };
    for (const ch of text) {
      this.t += Math.max(15, Math.round(meanMs * (1 + jitter * (this.rand() * 2 - 1))));
      if (this.rand() < pauseRate) this.t += 2_000 + Math.round(this.rand() * 8_000);
      if (this.rand() < typoRate) {
        this.edit("input.type", "x");
        this.t += 150;
        this.edit("delete", "", 1);
        this.t += 120;
      }
      this.edit("input.type", ch);
    }
    return this;
  }

  /** Typing with a near-constant rhythm, as a script or an auto-typer produces. */
  typeRobotically(text: string, intervalMs = 60, jitterMs = 2) {
    for (const ch of text) {
      this.t += intervalMs + Math.round((this.rand() * 2 - 1) * jitterMs);
      this.edit("input.type", ch);
    }
    return this;
  }

  /** Accepting an editor completion inserts a chunk at once. */
  complete(text: string) {
    this.t += 250;
    this.edit("input.complete", text);
    return this;
  }

  paste(text: string) {
    this.t += 400;
    this.edit("input.paste", text);
    return this;
  }

  /** An insertion with no user-event annotation (e.g. a scripted dispatch). */
  inject(text: string) {
    this.t += 50;
    this.edit("other", text);
    return this;
  }

  /** Deletes the last `n` characters with a burst of backspaces. */
  backspace(n: number) {
    for (let i = 0; i < n && this.doc.length > 0; i++) {
      this.t += 60;
      this.edit("delete", "", 1);
    }
    return this;
  }

  undo(chars: number) {
    this.t += 300;
    this.edit("undo", "", Math.min(chars, this.doc.length));
    return this;
  }

  blur() {
    this.t += 100;
    this.push("blur", {});
    return this;
  }

  focus() {
    this.t += 100;
    this.push("focus", {});
    return this;
  }

  hidden(ms: number) {
    this.t += 100;
    this.push("visibility", { state: "hidden" });
    this.t += ms;
    this.push("visibility", { state: "visible" });
    return this;
  }

  heartbeat() {
    this.push("heartbeat", { docLength: this.doc.length });
    return this;
  }

  run() {
    this.t += 200;
    this.snapshotSources.set(this.seq, this.doc);
    this.push("snapshot", { reason: "run", sha256: sha(this.doc), bytes: this.doc.length });
    this.push("run", {});
    return this;
  }

  /** Snapshot + submit marker, as the client does before submitting. Returns the submit seq. */
  submitMarker(): number {
    this.t += 200;
    this.snapshotSources.set(this.seq, this.doc);
    this.push("snapshot", { reason: "submit", sha256: sha(this.doc), bytes: this.doc.length });
    this.push("submit", {});
    return this.seq - 1;
  }

  get source() {
    return this.doc;
  }
  get now() {
    return new Date(this.t);
  }

  /** The same events in the client wire format (schema v1), for ingestion tests. */
  wireEvents(): Record<string, unknown>[] {
    return this.events.map((e) => {
      const base = { seq: e.seq, t: e.clientTs.getTime(), type: e.type };
      if (e.type === "snapshot") return { ...base, source: this.snapshotSources.get(e.seq) ?? "", reason: e.payload.reason };
      return { ...base, ...e.payload };
    });
  }

  build(): AnalysisSession {
    return { id: this.sessionId, startedAt: this.startedAt, maxSeq: this.seq - 1, purged: false, events: this.events };
  }
}

export function submissionFrom(b: TimelineBuilder, id: string, seq: number, verdict = "accepted", source = b.source): AnalysisSubmission {
  return {
    id,
    kind: "submission",
    createdAt: new Date(b.now.getTime() + 500),
    status: "judged",
    verdict,
    source,
    sourceSha256: sha(source),
    ideSessionId: b.sessionId,
    ideSeq: seq,
  };
}

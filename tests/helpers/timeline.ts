import { createHash } from "node:crypto";
import type { AnalysisEvent, AnalysisSession, AnalysisSubmission } from "@/lib/integrity/features";

export const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Deterministic PRNG (mulberry32) so synthetic timelines are reproducible. */
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

/**
 * Builds a synthetic editor session the way the client recorder would emit
 * it. SYNTHETIC: used only for tests and the labelled evaluation scenarios.
 */
export class TimelineBuilder {
  private seq = 0;
  private t: number;
  private doc = "";
  readonly events: AnalysisEvent[] = [];
  private readonly snapshotSources = new Map<number, string>();
  private readonly rand: () => number;

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
    const ts = new Date(this.t);
    this.events.push({ seq: this.seq, type, clientTs: ts, receivedAt: new Date(this.t + 1500), arrival: this.seq, payload });
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

  /** Human-like typing: one event per character, jittered intervals, occasional pauses and typos. */
  type(text: string, { meanMs = 170, jitter = 0.6, typoRate = 0.03 } = {}) {
    for (const ch of text) {
      this.t += Math.max(20, Math.round(meanMs * (1 + jitter * (this.rand() * 2 - 1))));
      if (this.rand() < 0.02) this.t += 2_000 + Math.round(this.rand() * 6_000); // thinking pause
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

  /** Perfectly regular typing, as a script might produce. */
  typeRobotically(text: string, intervalMs = 60) {
    for (const ch of text) {
      this.t += intervalMs;
      this.edit("input.type", ch);
    }
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

  undo(chars: number) {
    this.t += 300;
    this.edit("undo", "", chars);
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

  heartbeat() {
    this.push("heartbeat", { docLength: this.doc.length });
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

export const SOLUTION = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    sort(a.begin(), a.end());
    long long best = 0, run = 0;
    for (int i = 0; i < n; i++) {
        run = max(0LL, run + a[i]);
        best = max(best, run);
    }
    cout << best << "\\n";
    return 0;
}
`;

// Pure data-quality analysis of one editor session. Telemetry is client-side
// evidence: it can be missing, delayed, reordered or manipulated. These
// warnings travel with every downstream feature and assessment so that
// reviewers never read an absence of data as evidence of anything.

export type QualityEvent = {
  seq: number;
  type: string;
  clientTs: Date;
  receivedAt: Date;
  arrival: number;
  payload: Record<string, unknown>;
};
export type QualitySubmission = { id: string; ideSeq: number | null; sourceSha256: string };
export type QualitySnapshot = { seq: number; sourceSha256: string; reason: string | null };

export type QualityWarning = {
  code:
    | "empty_session"
    | "missing_events"
    | "out_of_order_delivery"
    | "telemetry_gap"
    | "clock_skew"
    | "submission_snapshot_missing"
    | "submission_snapshot_mismatch"
    | "purged";
  severity: "info" | "warning";
  message: string;
  detail?: Record<string, unknown>;
};

/** The client heartbeats every 30 s while visible; allow generous slack before calling it a gap. */
export const GAP_THRESHOLD_MS = 90_000;
export const SKEW_THRESHOLD_MS = 2 * 60_000;

export function missingRanges(seqs: number[], maxSeq: number): [number, number][] {
  const have = new Set(seqs);
  const ranges: [number, number][] = [];
  let start = -1;
  for (let s = 0; s <= maxSeq; s++) {
    if (!have.has(s)) {
      if (start < 0) start = s;
    } else if (start >= 0) {
      ranges.push([start, s - 1]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, maxSeq]);
  return ranges;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function analyzeSessionQuality(input: {
  events: QualityEvent[];
  maxSeq: number;
  snapshots: QualitySnapshot[];
  submissions: QualitySubmission[];
  purged?: boolean;
}): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (input.purged) {
    warnings.push({ code: "purged", severity: "info", message: "Raw events were removed by the retention policy." });
    return warnings;
  }
  const events = [...input.events].sort((a, b) => a.seq - b.seq);
  if (events.length === 0) {
    warnings.push({ code: "empty_session", severity: "info", message: "No telemetry was received for this editor session." });
  }

  const missing = missingRanges(events.map((e) => e.seq), input.maxSeq);
  if (missing.length > 0) {
    const total = missing.reduce((n, [a, b]) => n + b - a + 1, 0);
    warnings.push({
      code: "missing_events",
      severity: "warning",
      message: `${total} event(s) never arrived (${missing.length} gap(s) in the sequence).`,
      detail: { ranges: missing.slice(0, 20), total },
    });
  }

  let inversions = 0;
  for (let i = 1; i < events.length; i++) if (events[i]!.arrival < events[i - 1]!.arrival) inversions++;
  if (inversions > 0) {
    warnings.push({ code: "out_of_order_delivery", severity: "info", message: `${inversions} event(s) arrived out of order and were re-sequenced.`, detail: { inversions } });
  }

  // Silence while the tab was visible is a gap; silence while hidden is expected.
  let visible = true;
  const gaps: { afterSeq: number; ms: number }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const next = events[i + 1];
    if (e.type === "visibility") visible = e.payload.state === "visible";
    if (next && visible && next.seq === e.seq + 1) {
      const ms = next.clientTs.getTime() - e.clientTs.getTime();
      if (ms > GAP_THRESHOLD_MS) gaps.push({ afterSeq: e.seq, ms });
    }
  }
  if (gaps.length > 0) {
    const longest = Math.max(...gaps.map((g) => g.ms));
    warnings.push({
      code: "telemetry_gap",
      severity: "warning",
      message: `${gaps.length} period(s) without telemetry while the editor was visible (longest ${Math.round(longest / 60_000)} min).`,
      detail: { gaps: gaps.slice(0, 20) },
    });
  }

  if (events.length > 0) {
    const skew = median(events.map((e) => e.receivedAt.getTime() - e.clientTs.getTime()));
    if (Math.abs(skew) > SKEW_THRESHOLD_MS) {
      warnings.push({ code: "clock_skew", severity: "info", message: `Client clock differs from the server by about ${Math.round(skew / 1000)} s; client timestamps are shown as reported.`, detail: { skewMs: skew } });
    }
  }

  for (const s of input.submissions) {
    if (s.ideSeq == null) continue;
    // The client snapshots immediately before emitting the submit event.
    const snap = [...input.snapshots].filter((x) => x.seq < s.ideSeq! && (x.reason === "submit" || x.reason === "run")).sort((a, b) => b.seq - a.seq)[0];
    if (!snap) {
      warnings.push({ code: "submission_snapshot_missing", severity: "warning", message: "No editor snapshot was received for a submission from this session.", detail: { submissionId: s.id } });
    } else if (snap.sourceSha256 !== s.sourceSha256) {
      warnings.push({
        code: "submission_snapshot_mismatch",
        severity: "warning",
        message: "Submitted code differs from the editor contents captured at submit time.",
        detail: { submissionId: s.id, snapshotSeq: snap.seq },
      });
    }
  }
  return warnings;
}

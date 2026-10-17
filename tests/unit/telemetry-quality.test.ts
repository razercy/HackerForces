import { describe, expect, it } from "vitest";
import { GAP_THRESHOLD_MS, analyzeSessionQuality, missingRanges, type QualityEvent } from "@/lib/telemetry/quality";

const T = Date.parse("2030-01-01T10:00:00Z");
const ev = (seq: number, offsetMs: number, type = "edit", payload: Record<string, unknown> = {}, arrival = seq, receivedSkewMs = 1_000): QualityEvent => ({
  seq,
  type,
  clientTs: new Date(T + offsetMs),
  receivedAt: new Date(T + offsetMs + receivedSkewMs),
  arrival,
  payload,
});
const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe("missingRanges", () => {
  it("finds holes, including a trailing one", () => {
    expect(missingRanges([0, 1, 2], 2)).toEqual([]);
    expect(missingRanges([0, 3, 4, 7], 9)).toEqual([[1, 2], [5, 6], [8, 9]]);
    expect(missingRanges([], 2)).toEqual([[0, 2]]);
  });
});

describe("analyzeSessionQuality", () => {
  it("is clean for a complete, ordered, continuous session", () => {
    const events = [ev(0, 0, "session_start"), ev(1, 1_000), ev(2, 31_000, "heartbeat"), ev(3, 61_000, "heartbeat")];
    expect(analyzeSessionQuality({ events, maxSeq: 3, snapshots: [], submissions: [] })).toEqual([]);
  });

  it("flags an empty session", () => {
    expect(codes(analyzeSessionQuality({ events: [], maxSeq: -1, snapshots: [], submissions: [] }))).toEqual(["empty_session"]);
  });

  it("reports missing sequence ranges and out-of-order delivery separately", () => {
    const events = [ev(0, 0, "edit", {}, 0), ev(2, 2_000, "edit", {}, 2), ev(1, 1_000, "edit", {}, 3), ev(5, 5_000, "edit", {}, 1)];
    const w = analyzeSessionQuality({ events, maxSeq: 5, snapshots: [], submissions: [] });
    expect(w.find((x) => x.code === "missing_events")?.detail).toEqual({ ranges: [[3, 4]], total: 2 });
    expect(codes(w)).toContain("out_of_order_delivery");
  });

  it("treats silence while visible as a gap, but not silence while the tab was hidden", () => {
    const visibleGap = [ev(0, 0), ev(1, GAP_THRESHOLD_MS + 60_000)];
    expect(codes(analyzeSessionQuality({ events: visibleGap, maxSeq: 1, snapshots: [], submissions: [] }))).toEqual(["telemetry_gap"]);

    const hiddenGap = [ev(0, 0, "visibility", { state: "hidden" }), ev(1, 10 * 60_000, "visibility", { state: "visible" })];
    expect(analyzeSessionQuality({ events: hiddenGap, maxSeq: 1, snapshots: [], submissions: [] })).toEqual([]);
  });

  it("reports client clock skew from the median received-minus-client delay", () => {
    const events = [0, 1, 2].map((s) => ev(s, s * 1_000, "edit", {}, s, 10 * 60_000));
    const w = analyzeSessionQuality({ events, maxSeq: 2, snapshots: [], submissions: [] });
    expect(w).toMatchObject([{ code: "clock_skew", detail: { skewMs: 10 * 60_000 } }]);
  });

  it("checks each submission against the snapshot taken just before its submit event", () => {
    const events = [ev(0, 0), ev(1, 1_000, "snapshot"), ev(2, 1_100, "submit"), ev(3, 2_000, "snapshot"), ev(4, 2_100, "submit")];
    const snapshots = [
      { seq: 1, sourceSha256: "aaa", reason: "submit" },
      { seq: 3, sourceSha256: "bbb", reason: "submit" },
    ];
    const ok = analyzeSessionQuality({ events, maxSeq: 4, snapshots, submissions: [{ id: "s1", ideSeq: 2, sourceSha256: "aaa" }] });
    expect(ok).toEqual([]);

    const mismatch = analyzeSessionQuality({ events, maxSeq: 4, snapshots, submissions: [{ id: "s2", ideSeq: 4, sourceSha256: "zzz" }] });
    expect(mismatch).toMatchObject([{ code: "submission_snapshot_mismatch", detail: { submissionId: "s2", snapshotSeq: 3 } }]);

    const missing = analyzeSessionQuality({ events, maxSeq: 4, snapshots: [], submissions: [{ id: "s3", ideSeq: 2, sourceSha256: "aaa" }] });
    expect(codes(missing)).toEqual(["submission_snapshot_missing"]);
  });

  it("reports only 'purged' once retention removed the data", () => {
    expect(codes(analyzeSessionQuality({ events: [], maxSeq: 10, snapshots: [], submissions: [], purged: true }))).toEqual(["purged"]);
  });
});

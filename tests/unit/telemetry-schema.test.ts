import { describe, expect, it } from "vitest";
import { MAX_EVENTS_PER_BATCH, TELEMETRY_SCHEMA_VERSION, telemetryBatchSchema } from "@/lib/telemetry/events";

const sessionId = "6a2cda3f-3d2b-4530-b097-649f27c83c92";
const edit = (seq: number) => ({ seq, t: 1_900_000_000_000 + seq, type: "edit", origin: "input.type", changes: 1, from: 0, inserted: 1, deleted: 0, insertedLines: 0, docLength: 10 });
const batch = (events: unknown[], extra: Record<string, unknown> = {}) => ({ sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events, ...extra });

describe("telemetry batch schema", () => {
  it("accepts a well-formed batch of mixed events", () => {
    const ok = telemetryBatchSchema.safeParse(
      batch([
        { seq: 0, t: 1, type: "session_start", docLength: 0, restoredDraft: false },
        edit(1),
        { seq: 2, t: 3, type: "snapshot", source: "int main(){}", reason: "interval" },
        { seq: 3, t: 4, type: "visibility", state: "hidden" },
        { seq: 4, t: 5, type: "submit" },
      ]),
    );
    expect(ok.success).toBe(true);
  });

  it("rejects unknown event types, unknown fields and wrong schema versions", () => {
    expect(telemetryBatchSchema.safeParse(batch([{ seq: 0, t: 1, type: "keylog", key: "a" }])).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch([{ ...edit(0), text: "secret" }])).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch([edit(0)], { schemaVersion: 99 })).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch([{ ...edit(0), origin: "clipboard.read" }])).success).toBe(false);
  });

  it("rejects empty, oversized and internally duplicated batches", () => {
    expect(telemetryBatchSchema.safeParse(batch([])).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch(Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, i) => edit(i)))).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch([edit(1), edit(1)])).success).toBe(false);
    expect(telemetryBatchSchema.safeParse(batch([{ seq: 0, t: 1, type: "snapshot", source: "x".repeat(64 * 1024 + 1), reason: "interval" }])).success).toBe(false);
  });
});

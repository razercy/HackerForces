import { z } from "zod";
import { MAX_SOURCE_BYTES } from "@/lib/submissions";

// Versioned wire format for editor telemetry. Client-safe; the server
// validates every batch against it. Bump TELEMETRY_SCHEMA_VERSION on any
// incompatible change and keep old parsers for stored data.

export const TELEMETRY_SCHEMA_VERSION = 1;

export const TELEMETRY_EVENT_TYPES = [
  "session_start",
  "edit",
  "snapshot",
  "focus",
  "blur",
  "visibility",
  "heartbeat",
  "run",
  "submit",
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

/** CodeMirror user-event origins we distinguish (see classifyTransaction). */
export const EDIT_ORIGINS = ["input.type", "input.paste", "input.drop", "input.complete", "input", "delete", "undo", "redo", "move", "set", "other"] as const;
export type EditOrigin = (typeof EDIT_ORIGINS)[number];

export const MAX_EVENTS_PER_BATCH = 200;
/** Server-side cap on a raw batch body: one maximal snapshot plus overhead. */
export const MAX_BATCH_BYTES = 100 * 1024;
/** Client target per batch; also the budget for fetch keepalive (64 KiB) on page unload. */
export const TARGET_BATCH_BYTES = 56 * 1024;
export const MAX_SEQ = 1_000_000;

const count = z.number().int().min(0).max(10_000_000);
const base = { seq: z.number().int().min(0).max(MAX_SEQ), t: z.number().int().positive() };

export const telemetryEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("session_start"), docLength: count, restoredDraft: z.boolean() }).strict(),
  z
    .object({
      ...base,
      type: z.literal("edit"),
      origin: z.enum(EDIT_ORIGINS),
      /** Number of changed ranges in the transaction. */
      changes: z.number().int().min(1).max(10_000),
      /** Position of the first change in the old document. */
      from: count,
      inserted: count,
      deleted: count,
      insertedLines: count,
      docLength: count,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("snapshot"),
      source: z.string().refine((s) => new TextEncoder().encode(s).length <= MAX_SOURCE_BYTES, "snapshot too large"),
      reason: z.enum(["initial", "interval", "run", "submit", "unload"]),
    })
    .strict(),
  z.object({ ...base, type: z.literal("focus") }).strict(),
  z.object({ ...base, type: z.literal("blur") }).strict(),
  z.object({ ...base, type: z.literal("visibility"), state: z.enum(["visible", "hidden"]) }).strict(),
  z.object({ ...base, type: z.literal("heartbeat"), docLength: count }).strict(),
  z.object({ ...base, type: z.literal("run") }).strict(),
  z.object({ ...base, type: z.literal("submit") }).strict(),
]);
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export const telemetryBatchSchema = z
  .object({
    sessionId: z.uuid(),
    schemaVersion: z.literal(TELEMETRY_SCHEMA_VERSION),
    events: z.array(telemetryEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict()
  .refine((b) => new Set(b.events.map((e) => e.seq)).size === b.events.length, { message: "Duplicate seq within batch", path: ["events"] });
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;

export const startSessionSchema = z
  .object({
    contestSlug: z.string().min(1).max(64),
    label: z.string().trim().toUpperCase().regex(/^[A-Z][0-9]?$/),
    clientStartedAt: z.number().int().positive(),
  })
  .strict();

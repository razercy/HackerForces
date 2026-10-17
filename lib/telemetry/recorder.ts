"use client";

import type { ViewUpdate } from "@codemirror/view";
import { classifyTransaction, summarizeChanges } from "./classify";
import { MAX_EVENTS_PER_BATCH, TARGET_BATCH_BYTES, TELEMETRY_SCHEMA_VERSION, type TelemetryEvent } from "./events";

// Distributive Omit so each event variant keeps its own fields.
type EventBody = TelemetryEvent extends infer E ? (E extends TelemetryEvent ? Omit<E, "seq" | "t"> : never) : never;

export type RecorderState = "starting" | "recording" | "offline" | "stopped";
export type RecorderStatus = { state: RecorderState; pending: number; message?: string };

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT_EVENTS = 100;
const HEARTBEAT_MS = 30_000;
const SNAPSHOT_EVERY_EDITS = 50;
const OUTBOX_PREFIX = "hf:tel:outbox:";
const MAX_BACKOFF_MS = 60_000;

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota or privacy mode: the in-memory queue still works for this page.
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
  keys(): string[] {
    try {
      return Object.keys(window.localStorage);
    } catch {
      return [];
    }
  },
};

/**
 * Records editor activity for one editor mount and ships it in batches.
 *
 * Guarantees: every event gets a unique, increasing seq; unsent events are
 * mirrored to localStorage so a reload or crash does not lose them (they are
 * re-sent on the next page load); the server de-duplicates by (session, seq),
 * so retrying is always safe. Nothing outside the editor is observed except
 * the page's own visibility.
 */
export class TelemetryRecorder {
  private sessionId: string | null = null;
  private seq = 0;
  private queue: TelemetryEvent[] = [];
  private inFlight = false;
  private backoffMs = 0;
  private nextAttemptAt = 0;
  private editsSinceSnapshot = 0;
  private dirtySinceSnapshot = false;
  private lastDoc = "";
  private timers: ReturnType<typeof setInterval>[] = [];
  private status: RecorderStatus = { state: "starting", pending: 0 };
  private disposed = false;
  private readonly onVisibility = () => this.handleVisibility();
  private readonly onPageHide = () => this.handleUnload();

  constructor(
    private readonly opts: { contestSlug: string; label: string; onStatus?: (s: RecorderStatus) => void },
  ) {}

  /** Turns one CodeMirror view update into edit/focus events. */
  handleUpdate(u: ViewUpdate): void {
    if (this.disposed) return;
    for (const tr of u.transactions) {
      if (!tr.docChanged) continue;
      this.record({ type: "edit", origin: classifyTransaction(tr), ...summarizeChanges(tr) });
      this.editsSinceSnapshot++;
      this.dirtySinceSnapshot = true;
    }
    if (u.docChanged) this.lastDoc = u.state.doc.toString();
    if (u.focusChanged) this.record({ type: u.view.hasFocus ? "focus" : "blur" });
    if (this.editsSinceSnapshot >= SNAPSHOT_EVERY_EDITS) this.snapshot("interval");
  }

  async start(initialDoc: string, restoredDraft: boolean): Promise<void> {
    this.lastDoc = initialDoc;
    this.record({ type: "session_start", docLength: initialDoc.length, restoredDraft });
    this.snapshot("initial");
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.timers.push(
      setInterval(() => void this.flush(), FLUSH_INTERVAL_MS),
      setInterval(() => {
        if (document.visibilityState !== "visible") return;
        this.record({ type: "heartbeat", docLength: this.lastDoc.length });
        if (this.dirtySinceSnapshot) this.snapshot("interval");
      }, HEARTBEAT_MS),
    );
    void this.resendOrphanedOutboxes();
    await this.openSession();
  }

  /**
   * Snapshot + run/submit marker, flushed before the request is sent.
   * Returns the link the submission should carry (null if no session yet).
   */
  async beforeSubmit(kind: "run" | "submit", source: string): Promise<{ ideSessionId: string; ideSeq: number } | null> {
    this.lastDoc = source;
    this.snapshot(kind);
    const seq = this.record({ type: kind });
    await Promise.race([this.flush(), new Promise((r) => setTimeout(r, 2_000))]);
    return this.sessionId ? { ideSessionId: this.sessionId, ideSeq: seq } : null;
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach(clearInterval);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.persist();
    void this.flush({ keepalive: true });
  }

  // ------------------------------------------------------------------ internals

  private record(body: EventBody): number {
    const seq = this.seq++;
    this.queue.push({ ...body, seq, t: Date.now() } as TelemetryEvent);
    this.setStatus({ pending: this.queue.length });
    if (this.queue.length >= FLUSH_AT_EVENTS) void this.flush();
    return seq;
  }

  private snapshot(reason: "initial" | "interval" | "run" | "submit" | "unload") {
    this.record({ type: "snapshot", source: this.lastDoc, reason });
    this.editsSinceSnapshot = 0;
    this.dirtySinceSnapshot = false;
  }

  private handleVisibility() {
    const state = document.visibilityState === "visible" ? "visible" : "hidden";
    this.record({ type: "visibility", state });
    if (state === "hidden") {
      this.persist();
      void this.flush({ keepalive: true });
    }
  }

  private handleUnload() {
    if (this.dirtySinceSnapshot) this.snapshot("unload");
    this.persist();
    void this.flush({ keepalive: true });
  }

  private async openSession(): Promise<void> {
    for (let attempt = 0; !this.disposed && !this.sessionId; attempt++) {
      try {
        const res = await fetch("/api/telemetry/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contestSlug: this.opts.contestSlug, label: this.opts.label, clientStartedAt: Date.now() }),
        });
        if (res.ok) {
          this.sessionId = ((await res.json()) as { sessionId: string }).sessionId;
          this.setStatus({ state: "recording", message: undefined });
          this.persist();
          void this.flush();
          return;
        }
        if (res.status < 500 && res.status !== 429) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          this.setStatus({ state: "stopped", message: body.error?.message ?? "Recording could not start" });
          return;
        }
      } catch {
        // network: retry below
      }
      this.setStatus({ state: "offline", message: "Connecting…" });
      await new Promise((r) => setTimeout(r, Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt)));
    }
  }

  /** Takes a prefix of the queue that fits the byte budget (always at least one event). */
  private takeBatch(budget: number): TelemetryEvent[] {
    const out: TelemetryEvent[] = [];
    let bytes = 200;
    for (const e of this.queue) {
      const size = JSON.stringify(e).length + 1;
      if (out.length > 0 && (bytes + size > budget || out.length >= MAX_EVENTS_PER_BATCH)) break;
      out.push(e);
      bytes += size;
    }
    return out;
  }

  async flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
    if (!this.sessionId || this.inFlight || this.queue.length === 0) return;
    if (!keepalive && Date.now() < this.nextAttemptAt) return;
    const batch = this.takeBatch(TARGET_BATCH_BYTES);
    const body = JSON.stringify({ sessionId: this.sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events: batch });
    // fetch keepalive is limited to ~64 KiB in flight; larger batches stay in the outbox.
    if (keepalive && body.length > 60 * 1024) return;

    this.inFlight = true;
    try {
      const res = await fetch("/api/telemetry/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        // Accepted, or permanently rejected (validation, session closed): drop either way so the queue cannot jam.
        const sent = new Set(batch.map((e) => e.seq));
        this.queue = this.queue.filter((e) => !sent.has(e.seq));
        this.backoffMs = 0;
        this.nextAttemptAt = 0;
        this.persist();
        if (res.ok) this.setStatus({ state: "recording", pending: this.queue.length, message: undefined });
        else this.setStatus({ state: "stopped", pending: this.queue.length, message: "Some activity could not be recorded" });
        if (this.queue.length > 0 && !keepalive) void Promise.resolve().then(() => this.flush());
        return;
      }
      this.retryLater();
    } catch {
      this.retryLater();
    } finally {
      this.inFlight = false;
    }
  }

  private retryLater() {
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs ? this.backoffMs * 2 : 2_000);
    this.nextAttemptAt = Date.now() + this.backoffMs;
    this.setStatus({ state: "offline", pending: this.queue.length, message: "Offline — will retry" });
    this.persist();
  }

  private persist() {
    if (!this.sessionId) return;
    const key = OUTBOX_PREFIX + this.sessionId;
    if (this.queue.length === 0) storage.remove(key);
    else storage.set(key, JSON.stringify(this.queue));
  }

  /** Re-sends events left behind by an earlier page load (closed tab, crash, offline). */
  private async resendOrphanedOutboxes() {
    for (const key of storage.keys()) {
      if (!key.startsWith(OUTBOX_PREFIX)) continue;
      const sessionId = key.slice(OUTBOX_PREFIX.length);
      if (sessionId === this.sessionId) continue;
      let events: TelemetryEvent[];
      try {
        events = JSON.parse(storage.get(key) ?? "[]") as TelemetryEvent[];
      } catch {
        storage.remove(key);
        continue;
      }
      for (let i = 0; i < events.length; i += 50) {
        try {
          const res = await fetch("/api/telemetry/batches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, schemaVersion: TELEMETRY_SCHEMA_VERSION, events: events.slice(i, i + 50) }),
          });
          if (!res.ok && (res.status >= 500 || res.status === 429)) return; // try again on a later load
        } catch {
          return;
        }
      }
      storage.remove(key);
    }
  }

  private setStatus(patch: Partial<RecorderStatus>) {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus?.(this.status);
  }
}

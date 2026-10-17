"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANGUAGE_LABELS } from "@/lib/languages";
import { isTerminal, type SubmissionKind, type SubmissionStatus, type Verdict } from "@/lib/submissions";
import { VerdictBadge } from "@/components/verdict-badge";
import type { ViewUpdate } from "@codemirror/view";
import { TelemetryRecorder, type RecorderStatus } from "@/lib/telemetry/recorder";
import { CodeEditor, type CodeEditorHandle } from "./code-editor";

const TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`;

type Result = {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  verdict: Verdict | null;
  timeMs: number | null;
  memoryKb: number | null;
  passedTests: number | null;
  totalTests: number | null;
  failedTest: number | null;
  compileOutput: string | null;
};

// Drafts are a per-browser convenience only; the server stores nothing until you run or submit.
const draftKey = (slug: string, label: string) => `hf:draft:${slug}:${label}`;
function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): drafts simply are not kept.
  }
}

const POLL_MS = [500, 1000, 1000, 2000];
const POLL_GIVE_UP_MS = 3 * 60_000;

export function Workspace({ contestSlug, label, noticeHref }: { contestSlug: string; label: string; noticeHref: string }) {
  const router = useRouter();
  const editor = useRef<CodeEditorHandle>(null);
  const key = draftKey(contestSlug, label);
  const recorder = useRef<TelemetryRecorder | null>(null);
  const [recording, setRecording] = useState<RecorderStatus>({ state: "starting", pending: 0 });
  // Forwards editor updates to whichever recorder the current effect owns.
  const onEditorUpdate = useCallback((u: ViewUpdate) => recorder.current?.handleUpdate(u), []);
  const restoredDraft = useRef(false);
  const [busy, setBusy] = useState<SubmissionKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => () => pollAbort.current?.abort(), []);

  // One recorder per mount (Strict Mode's extra dev mount just opens and abandons a session).
  useEffect(() => {
    const r = new TelemetryRecorder({ contestSlug, label, onStatus: setRecording });
    recorder.current = r;
    void r.start(editor.current?.getValue() ?? "", restoredDraft.current);
    return () => {
      recorder.current = null;
      r.dispose();
    };
  }, [contestSlug, label]);

  const onChange = useCallback(
    (value: string) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => writeDraft(key, value), 400);
    },
    [key],
  );

  async function poll(id: string, signal: AbortSignal) {
    const started = Date.now();
    for (let i = 0; !signal.aborted; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS[Math.min(i, POLL_MS.length - 1)]));
      if (signal.aborted) return;
      try {
        const res = await fetch(`/api/submissions/${id}`, { cache: "no-store", signal });
        if (res.ok) {
          const r = (await res.json()) as Result;
          setResult(r);
          if (isTerminal(r.status)) {
            router.refresh(); // update the history list
            return;
          }
        }
      } catch {
        if (signal.aborted) return; // otherwise a transient network error: keep polling
      }
      if (Date.now() - started > POLL_GIVE_UP_MS) {
        setError("Still waiting for the judge. Your submission is saved; check your submissions page later.");
        return;
      }
    }
  }

  async function send(kind: SubmissionKind) {
    if (busy) return;
    const source = editor.current?.getValue() ?? "";
    setBusy(kind);
    setError(null);
    pollAbort.current?.abort();
    try {
      // Snapshot + marker first, so reviewers can line up editor contents with the submitted code.
      const link = (await recorder.current?.beforeSubmit(kind === "sample_run" ? "run" : "submit", source)) ?? null;
      const res = await fetch(`/api/contests/${encodeURIComponent(contestSlug)}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, language: "cpp17", kind, source, ...(link ?? {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !body.id) {
        setError(body.error?.message ?? "Could not submit. Please try again.");
        return;
      }
      setResult({ id: body.id, kind, status: "queued", verdict: null, timeMs: null, memoryKb: null, passedTests: null, totalTests: null, failedTest: null, compileOutput: null });
      router.refresh();
      const ctl = new AbortController();
      pollAbort.current = ctl;
      void poll(body.id, ctl.signal);
    } finally {
      setBusy(null);
    }
  }

  const keyBindings = [
    { key: "Mod-Enter", run: () => (void send("sample_run"), true) },
    { key: "Mod-Shift-Enter", run: () => (void send("submission"), true) },
  ];

  return (
    <section aria-label="Code editor" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-600 dark:text-zinc-400">{LANGUAGE_LABELS.cpp17}</span>
          <RecordingIndicator status={recording} noticeHref={noticeHref} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => send("sample_run")}
            disabled={!!busy}
            className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Ctrl/⌘ + Enter"
          >
            {busy === "sample_run" ? "Sending…" : "Run examples"}
          </button>
          <button
            type="button"
            onClick={() => send("submission")}
            disabled={!!busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            title="Ctrl/⌘ + Shift + Enter"
          >
            {busy === "submission" ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>

      <div className="h-[28rem]">
        <CodeEditor
          ref={editor}
          ariaLabel={`Solution for problem ${label}`}
          initialValue={() => {
            const draft = readDraft(key);
            restoredDraft.current = draft != null;
            return draft ?? TEMPLATE;
          }}
          onChange={onChange}
          keyBindings={keyBindings}
          onUpdate={onEditorUpdate}
        />
      </div>
      <p className="text-xs text-zinc-500">
        Drafts are kept in this browser only. &ldquo;Run examples&rdquo; checks the public examples and does not count; &ldquo;Submit&rdquo; is judged on hidden tests and
        counts for standings. Every run and submission stores an exact copy of your code. Press Esc then Tab to leave the editor.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite" className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{result.kind === "sample_run" ? "Example run" : "Submission"}</span>
            <VerdictBadge status={result.status} verdict={result.verdict} failedTest={result.failedTest} />
            {result.status === "judged" && result.verdict !== "compilation_error" && (
              <span className="text-zinc-600 dark:text-zinc-400">
                {result.passedTests}/{result.totalTests} tests · {result.timeMs} ms · {Math.round((result.memoryKb ?? 0) / 1024)} MB
              </span>
            )}
          </div>
          {result.compileOutput && <pre className="max-h-48 overflow-auto rounded bg-zinc-50 p-2 font-mono text-xs dark:bg-zinc-900">{result.compileOutput}</pre>}
          {result.status === "failed" && <p className="text-amber-700 dark:text-amber-400">The platform could not judge this submission. It does not count against you.</p>}
        </div>
      )}
    </section>
  );
}

const INDICATOR: Record<RecorderStatus["state"], { dot: string; text: string }> = {
  starting: { dot: "bg-zinc-400", text: "Starting activity recording…" },
  recording: { dot: "bg-red-500", text: "Activity in this editor is recorded" },
  offline: { dot: "bg-amber-500", text: "Activity is recorded — saved locally, will sync" },
  stopped: { dot: "bg-zinc-400", text: "Activity recording unavailable" },
};

/** Always visible while the editor is mounted, so recording is never silent. */
function RecordingIndicator({ status, noticeHref }: { status: RecorderStatus; noticeHref: string }) {
  const v = INDICATOR[status.state];
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs dark:border-zinc-700">
      <span aria-hidden className={`h-2 w-2 rounded-full ${v.dot} ${status.state === "recording" ? "animate-pulse" : ""}`} />
      <span>
        {v.text}
        {status.message && status.state !== "recording" ? ` (${status.message})` : ""}
      </span>
      <a href={noticeHref} className="underline">
        What is recorded?
      </a>
    </span>
  );
}

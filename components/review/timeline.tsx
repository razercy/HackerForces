import { GAP_THRESHOLD_MS } from "@/lib/telemetry/quality";

export type TimelineEvent = { seq: number; type: string; clientTs: Date; payload: Record<string, unknown> };

export const ORIGIN_STYLES: Record<string, { label: string; color: string; text: string }> = {
  "input.type": { label: "Typed", color: "#71717a", text: "text-zinc-600 dark:text-zinc-400" },
  input: { label: "Input", color: "#71717a", text: "text-zinc-600 dark:text-zinc-400" },
  "input.complete": { label: "Autocomplete", color: "#0ea5e9", text: "text-sky-700 dark:text-sky-400" },
  "input.paste": { label: "Paste", color: "#f59e0b", text: "text-amber-700 dark:text-amber-400" },
  "input.drop": { label: "Drop", color: "#f97316", text: "text-orange-700 dark:text-orange-400" },
  other: { label: "Unattributed", color: "#dc2626", text: "text-red-700 dark:text-red-400" },
  set: { label: "Unattributed", color: "#dc2626", text: "text-red-700 dark:text-red-400" },
  delete: { label: "Delete", color: "#a1a1aa", text: "text-zinc-500" },
  undo: { label: "Undo", color: "#8b5cf6", text: "text-violet-700 dark:text-violet-400" },
  redo: { label: "Redo", color: "#8b5cf6", text: "text-violet-700 dark:text-violet-400" },
};
const BULK = new Set(["input.paste", "input.drop", "other", "set"]);
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** Document length over time, with non-typed insertions and focus loss marked. Server-rendered SVG. */
export function DocLengthChart({ events }: { events: TimelineEvent[] }) {
  const edits = events.filter((e) => e.type === "edit");
  if (edits.length < 2) return <p className="text-sm text-zinc-500">Not enough edits to chart.</p>;
  const t0 = events[0]!.clientTs.getTime();
  const t1 = events.at(-1)!.clientTs.getTime();
  const maxLen = Math.max(1, ...edits.map((e) => n(e.payload.docLength)));
  const W = 800;
  const H = 160;
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - 20) + 10);
  const y = (len: number) => H - 20 - (len / maxLen) * (H - 40);
  const path = edits.map((e, i) => `${i ? "L" : "M"}${x(e.clientTs.getTime()).toFixed(1)},${y(n(e.payload.docLength)).toFixed(1)}`).join(" ");
  const minutes = Math.round((t1 - t0) / 60_000);

  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full rounded-md bg-zinc-50 dark:bg-zinc-900" role="img" aria-label="Code length over time with paste and focus-loss markers">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-blue-600 dark:text-blue-400" />
        {events.map((e) => {
          const cx = x(e.clientTs.getTime());
          if (e.type === "edit" && BULK.has(String(e.payload.origin)) && n(e.payload.inserted) >= 20) {
            const s = ORIGIN_STYLES[String(e.payload.origin)]!;
            return (
              <circle key={e.seq} cx={cx} cy={y(n(e.payload.docLength))} r={Math.min(10, 3 + Math.sqrt(n(e.payload.inserted)) / 4)} fill={s.color} opacity={0.85}>
                <title>{`${s.label}: ${n(e.payload.inserted)} chars (seq ${e.seq})`}</title>
              </circle>
            );
          }
          if (e.type === "blur" || (e.type === "visibility" && e.payload.state === "hidden")) {
            return (
              <line key={e.seq} x1={cx} x2={cx} y1={H - 18} y2={H - 8} stroke="#a1a1aa" strokeWidth={2}>
                <title>{`Left editor (seq ${e.seq})`}</title>
              </line>
            );
          }
          if (e.type === "submit" || e.type === "run") {
            return (
              <line key={e.seq} x1={cx} x2={cx} y1={8} y2={H - 20} stroke={e.type === "submit" ? "#16a34a" : "#0ea5e9"} strokeDasharray="3 3">
                <title>{`${e.type} (seq ${e.seq})`}</title>
              </line>
            );
          }
          return null;
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>{minutes} min · max {maxLen} chars</span>
        <span>
          <span className="text-amber-600">●</span> paste
        </span>
        <span>
          <span className="text-orange-600">●</span> drop
        </span>
        <span>
          <span className="text-red-600">●</span> unattributed
        </span>
        <span>▏ left editor</span>
        <span className="text-green-700">┆ submit</span>
        <span className="text-sky-700">┆ run</span>
      </figcaption>
    </figure>
  );
}

function isNotable(e: TimelineEvent) {
  if (e.type === "edit") {
    const o = String(e.payload.origin);
    return BULK.has(o) || o === "undo" || o === "redo" || n(e.payload.inserted) >= 50 || n(e.payload.deleted) >= 50;
  }
  return e.type !== "heartbeat" && e.type !== "snapshot";
}

/** Event list. By default only notable events plus detected gaps; `all` shows everything. */
export function EventTable({ events, all }: { events: TimelineEvent[]; all: boolean }) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">No events.</p>;
  const t0 = events[0]!.clientTs.getTime();
  type Row = { kind: "event"; e: TimelineEvent } | { kind: "gap"; afterSeq: number; ms: number; missing: number };
  const rows: Row[] = [];
  let visible = true;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "visibility") visible = e.payload.state === "visible";
    if (all || isNotable(e)) rows.push({ kind: "event", e });
    const next = events[i + 1];
    if (next) {
      const ms = next.clientTs.getTime() - e.clientTs.getTime();
      const missing = next.seq - e.seq - 1;
      if (missing > 0 || (visible && ms > GAP_THRESHOLD_MS)) rows.push({ kind: "gap", afterSeq: e.seq, ms, missing });
    }
  }
  const fmt = (ms: number) => `+${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left font-mono text-xs">
        <thead className="sticky top-0 bg-white text-zinc-500 dark:bg-zinc-950">
          <tr>
            <th className="px-2 py-1 font-medium">seq</th>
            <th className="px-2 py-1 font-medium">time</th>
            <th className="px-2 py-1 font-medium">event</th>
            <th className="px-2 py-1 font-medium">detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.kind === "gap" ? (
              <tr key={`gap-${r.afterSeq}`} className="bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <td className="px-2 py-1" colSpan={4}>
                  {r.missing > 0 ? `${r.missing} event(s) missing after seq ${r.afterSeq}` : `No telemetry for ${Math.round(r.ms / 1000)} s while visible`}
                </td>
              </tr>
            ) : (
              <tr key={r.e.seq} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="px-2 py-1 text-zinc-500">{r.e.seq}</td>
                <td className="px-2 py-1 text-zinc-500">{fmt(r.e.clientTs.getTime() - t0)}</td>
                <td className={`px-2 py-1 ${r.e.type === "edit" ? (ORIGIN_STYLES[String(r.e.payload.origin)]?.text ?? "") : ""}`}>
                  {r.e.type === "edit" ? (ORIGIN_STYLES[String(r.e.payload.origin)]?.label ?? String(r.e.payload.origin)) : r.e.type}
                </td>
                <td className="px-2 py-1">
                  {r.e.type === "edit"
                    ? `+${n(r.e.payload.inserted)} / −${n(r.e.payload.deleted)} → ${n(r.e.payload.docLength)} chars`
                    : r.e.type === "visibility"
                      ? String(r.e.payload.state)
                      : r.e.type === "snapshot"
                        ? `${String(r.e.payload.reason)} · ${n(r.e.payload.bytes)} B`
                        : ""}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

import { diffLines, diffStats, withContext } from "@/lib/integrity/diff";

export function DiffView({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const lines = diffLines(before, after);
  const { added, removed } = diffStats(lines);
  const hunks = withContext(lines, 3);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {beforeLabel} → {afterLabel}: <span className="text-green-700 dark:text-green-400">+{added}</span> / <span className="text-red-700 dark:text-red-400">−{removed}</span> lines
      </p>
      {added === 0 && removed === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Identical.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-md border border-zinc-200 font-mono text-xs dark:border-zinc-800">
          {hunks.map((h, i) =>
            "skipped" in h ? (
              <div key={i} className="bg-zinc-50 px-2 py-1 text-zinc-500 dark:text-zinc-400 dark:bg-zinc-900">
                ⋯ {h.skipped} unchanged line(s)
              </div>
            ) : (
              h.lines.map((l, j) => (
                <div
                  key={`${i}-${j}`}
                  className={`flex whitespace-pre ${l.kind === "add" ? "bg-green-50 dark:bg-green-950/40" : l.kind === "del" ? "bg-red-50 dark:bg-red-950/40" : ""}`}
                >
                  <span className="w-10 shrink-0 select-none px-1 text-right text-zinc-400">{l.oldNo ?? ""}</span>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-zinc-400">{l.newNo ?? ""}</span>
                  <span className="w-4 shrink-0 select-none text-center">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span>{l.text}</span>
                </div>
              ))
            ),
          )}
        </div>
      )}
    </div>
  );
}

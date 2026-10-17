// Line diff for code-evolution views. Pure, client-safe.
// Common prefix/suffix are trimmed first; the middle uses an LCS table, which
// is fine for contest-sized sources (≤ 64 KB ⇒ a few thousand lines).

export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null };
export type DiffStats = { added: number; removed: number };

const MAX_CELLS = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push({ kind: "same", text: a[i]!, oldNo: i + 1, newNo: i + 1 });

  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  if (am.length * bm.length > MAX_CELLS) {
    // Too large for an exact LCS: show as a replacement block.
    am.forEach((t, i) => out.push({ kind: "del", text: t, oldNo: pre + i + 1, newNo: null }));
    bm.forEach((t, j) => out.push({ kind: "add", text: t, oldNo: null, newNo: pre + j + 1 }));
  } else {
    const n = am.length;
    const m = bm.length;
    const lcs = new Uint16Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] = am[i] === bm[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        out.push({ kind: "same", text: am[i]!, oldNo: pre + i + 1, newNo: pre + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || lcs[i * (m + 1) + j + 1]! >= lcs[(i + 1) * (m + 1) + j]!)) {
        out.push({ kind: "add", text: bm[j]!, oldNo: null, newNo: pre + j + 1 });
        j++;
      } else {
        out.push({ kind: "del", text: am[i]!, oldNo: pre + i + 1, newNo: null });
        i++;
      }
    }
  }
  for (let k = 0; k < suf; k++) {
    const oi = a.length - suf + k;
    const ni = b.length - suf + k;
    out.push({ kind: "same", text: a[oi]!, oldNo: oi + 1, newNo: ni + 1 });
  }
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  return { added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "del").length };
}

export type Hunk = { lines: DiffLine[] } | { skipped: number };

/** Collapses long unchanged runs, keeping `context` lines around changes. */
export function withContext(lines: DiffLine[], context = 3): Hunk[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.kind !== "same") keep.fill(1, Math.max(0, i - context), Math.min(lines.length, i + context + 1));
  });
  const hunks: Hunk[] = [];
  let current: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) {
        hunks.push({ skipped });
        skipped = 0;
      }
      current.push(l);
    } else {
      if (current.length) {
        hunks.push({ lines: current });
        current = [];
      }
      skipped++;
    }
  });
  if (current.length) hunks.push({ lines: current });
  if (skipped) hunks.push({ skipped });
  return hunks;
}

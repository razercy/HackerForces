import type { Transaction } from "@codemirror/state";
import type { EditOrigin } from "./events";

// Most specific first: CodeMirror user events are hierarchical
// ("input.type.compose" matches "input.type" and "input").
const ORIGINS: readonly Exclude<EditOrigin, "input" | "other">[] = [
  "input.paste",
  "input.drop",
  "input.complete",
  "input.type",
  "delete",
  "undo",
  "redo",
  "move",
  "set",
];

/** Where a document change came from, per CodeMirror's userEvent annotation. */
export function classifyTransaction(tr: Transaction): EditOrigin {
  for (const o of ORIGINS) if (tr.isUserEvent(o)) return o;
  if (tr.isUserEvent("input")) return "input";
  return "other";
}

/** Size/position summary of a transaction's changes. Never includes the text itself. */
export function summarizeChanges(tr: Transaction) {
  let changes = 0;
  let from = -1;
  let inserted = 0;
  let deleted = 0;
  let insertedLines = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    changes++;
    if (from < 0) from = fromA;
    deleted += toA - fromA;
    inserted += text.length;
    insertedLines += text.lines - 1;
  });
  return { changes, from: Math.max(from, 0), inserted, deleted, insertedLines, docLength: tr.newDoc.length };
}

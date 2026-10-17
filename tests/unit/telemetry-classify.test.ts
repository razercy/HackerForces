import { EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { classifyTransaction, summarizeChanges } from "@/lib/telemetry/classify";

const state = EditorState.create({ doc: "int main() {}\n" });
const tr = (spec: TransactionSpec) => state.update(spec);

describe("classifyTransaction", () => {
  it("uses CodeMirror's userEvent annotations, most specific first", () => {
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }))).toBe("input.type");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "input.type.compose" }))).toBe("input.type");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "a\nb" }, userEvent: "input.paste" }))).toBe("input.paste");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "input.drop" }))).toBe("input.drop");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "input.complete" }))).toBe("input.complete");
    expect(classifyTransaction(tr({ changes: { from: 0, to: 3 }, userEvent: "delete.backward" }))).toBe("delete");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "undo" }))).toBe("undo");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "redo" }))).toBe("redo");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" }, userEvent: "input.indent" }))).toBe("input");
    expect(classifyTransaction(tr({ changes: { from: 0, insert: "x" } }))).toBe("other");
  });
});

describe("summarizeChanges", () => {
  it("reports sizes and positions, never the inserted text", () => {
    const t = tr({ changes: [{ from: 4, to: 8, insert: "solve\nmain" }, { from: 12, insert: "//" }], userEvent: "input.paste" });
    const summary = summarizeChanges(t);
    expect(summary).toEqual({ changes: 2, from: 4, inserted: 12, deleted: 4, insertedLines: 1, docLength: t.newDoc.length });
    expect(JSON.stringify(summary)).not.toContain("solve");
  });
});

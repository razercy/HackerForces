import { describe, expect, it } from "vitest";
import { diffLines, diffStats, withContext } from "@/lib/integrity/diff";

const render = (a: string, b: string) => diffLines(a, b).map((l) => (l.kind === "same" ? " " : l.kind === "add" ? "+" : "-") + l.text);

describe("diffLines", () => {
  it("returns only unchanged lines for identical input", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.kind === "same")).toBe(true);
  });

  it("finds insertions, deletions and replacements with correct line numbers", () => {
    expect(render("a\nb\nc", "a\nx\nc")).toEqual([" a", "+x", "-b", " c"]);
    const lines = diffLines("int main() {\n}\n", "int main() {\n  return 0;\n}\n");
    expect(lines.filter((l) => l.kind === "add")).toEqual([{ kind: "add", text: "  return 0;", oldNo: null, newNo: 2 }]);
    expect(diffStats(diffLines("a\nb\nc\nd", "a\nd"))).toEqual({ added: 0, removed: 2 });
  });

  it("reconstructs both sides exactly", () => {
    const a = "x\ny\nz\nw\nq";
    const b = "y\nz\nnew\nw\nq\nend";
    const d = diffLines(a, b);
    expect(d.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(a);
    expect(d.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(b);
  });

  it("collapses unchanged runs to context", () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l15", "CHANGED");
    const hunks = withContext(diffLines(a, b), 2);
    expect(hunks[0]).toEqual({ skipped: 13 });
    expect("lines" in hunks[1]! && hunks[1].lines.length).toBe(6);
    expect(hunks[2]).toEqual({ skipped: 12 });
  });
});

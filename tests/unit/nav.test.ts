import { describe, expect, it } from "vitest";
import { isCurrentPath } from "@/lib/nav";

describe("navigation current-page state", () => {
  it("marks a section and the pages below it, but not look-alike paths", () => {
    expect(isCurrentPath("/contests", "/contests")).toBe(true);
    expect(isCurrentPath("/contests/demo-round/problems/A", "/contests")).toBe(true);
    expect(isCurrentPath("/contestsarchive", "/contests")).toBe(false);
    expect(isCurrentPath("/admin/ops", "/admin/audit")).toBe(false);
  });

  it("exact links match only themselves, plus any extra sections they own", () => {
    const cases = { exact: true, also: ["/review/cases"] };
    expect(isCurrentPath("/review", "/review", cases)).toBe(true);
    expect(isCurrentPath("/review/cases/123", "/review", cases)).toBe(true);
    expect(isCurrentPath("/review/assessments", "/review", cases)).toBe(false);
    expect(isCurrentPath("/review/assessments", "/review/assessments")).toBe(true);
  });
});

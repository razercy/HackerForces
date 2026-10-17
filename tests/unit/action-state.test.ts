import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { echoed } from "@/lib/action-state";
import { list, optional, toActionState } from "@/lib/server/actions";
import { AppError } from "@/lib/server/errors";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("form action state", () => {
  it("echoes submitted values on validation failure, without framework fields", () => {
    const err = z.object({ slug: z.string().regex(/^[a-z]+$/) }).safeParse({ slug: "Bad!" }).error as ZodError;
    const state = toActionState(err, fd({ slug: "Bad!", title: "T", $ACTION_ID_abc: "" }));
    expect(state.ok).toBe(false);
    expect(state.fieldErrors?.slug?.length).toBe(1);
    expect(state.values).toEqual({ slug: "Bad!", title: "T" });
    expect(echoed(state, "slug", "fallback")).toBe("Bad!");
    expect(echoed({}, "slug", 42)).toBe("42");
    expect(echoed({}, "notes", null)).toBe("");
  });

  it("exposes AppError messages but hides unexpected errors", () => {
    expect(toActionState(new AppError("CONFLICT", "Slug taken", 409))).toMatchObject({ ok: false, message: "Slug taken" });
    const original = console.error;
    console.error = () => {};
    try {
      expect(toActionState(new Error("connection string postgres://secret"))).toEqual({
        ok: false,
        message: "Something went wrong. Please try again.",
        values: undefined,
      });
    } finally {
      console.error = original;
    }
  });

  it("rethrows Next.js control-flow errors (redirect / notFound)", () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
    expect(() => toActionState(redirectErr)).toThrow("NEXT_REDIRECT");
  });

  it("parses optional and list fields", () => {
    const f = fd({ notes: "  ", tags: "greedy, math  dp,," });
    expect(optional(f, "notes")).toBeNull();
    expect(optional(f, "missing")).toBeNull();
    expect(list(f, "tags")).toEqual(["greedy", "math", "dp"]);
  });
});

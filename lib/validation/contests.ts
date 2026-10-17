import { z } from "zod";
import { slugSchema } from "./problems";

export const MAX_CONTEST_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** ISO-8601 with an explicit offset, so server timezone never changes the meaning. */
const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const bothDates = (c: { startsAt: unknown; endsAt: unknown }) => c.startsAt instanceof Date && c.endsAt instanceof Date;

export const contestInputSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(20_000).default(""),
    startsAt: instant,
    endsAt: instant,
  })
  .strict()
  // Zod 4 still runs object refinements when a field failed, so only compare
  // once both instants actually parsed.
  .refine((c) => !bothDates(c) || c.endsAt > c.startsAt, { path: ["endsAt"], message: "End must be after start" })
  .refine((c) => !bothDates(c) || c.endsAt.getTime() - c.startsAt.getTime() <= MAX_CONTEST_DURATION_MS, {
    path: ["endsAt"],
    message: "Contests can last at most 14 days",
  });
export type ContestInput = z.infer<typeof contestInputSchema>;

export const attachProblemSchema = z
  .object({
    problemId: z.uuid(),
    label: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][0-9]?$/, "Label like A, B, C1"),
  })
  .strict();
export type AttachProblemInput = z.infer<typeof attachProblemSchema>;

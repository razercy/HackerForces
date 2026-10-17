import { z } from "zod";
import { LANGUAGES } from "@/lib/languages";

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens");

const markdown = (max: number) => z.string().max(max);

/** Max bytes per hidden-test field; mirrors the DB CHECK constraint. */
export const MAX_TEST_FIELD_BYTES = 256 * 1024;
const byteLimited = (label: string) =>
  z
    .string()
    .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_TEST_FIELD_BYTES, `${label} exceeds ${MAX_TEST_FIELD_BYTES / 1024} KB`);

/** Judges compare outputs token-wise later; here we only normalise line endings. */
const normaliseNewlines = (s: string) => s.replace(/\r\n?/g, "\n");

export const problemInputSchema = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1).max(120),
    statement: markdown(50_000).trim().min(1, "Statement is required"),
    inputFormat: markdown(20_000).trim().min(1, "Input format is required"),
    outputFormat: markdown(20_000).trim().min(1, "Output format is required"),
    constraints: markdown(10_000).trim().default(""),
    notes: markdown(20_000).trim().nullable().default(null),
    timeLimitMs: z.coerce.number().int().min(100).max(10_000),
    memoryLimitMb: z.coerce.number().int().min(16).max(1024),
    difficulty: z.coerce.number().int().min(800).max(3500).multipleOf(100).nullable().default(null),
    tags: z
      .array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,32}$/, "Tags: lowercase letters, digits, hyphens"))
      .max(10)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    templateNotes: markdown(5_000).trim().nullable().default(null),
  })
  .strict();
export type ProblemInput = z.infer<typeof problemInputSchema>;

export const exampleInputSchema = z
  .object({
    input: z.string().max(10_000).transform(normaliseNewlines),
    output: z.string().max(10_000).transform(normaliseNewlines),
    explanation: markdown(5_000).trim().nullable().default(null),
  })
  .strict();
export type ExampleInput = z.infer<typeof exampleInputSchema>;

export const testInputSchema = z
  .object({
    input: byteLimited("Input").transform(normaliseNewlines),
    expectedOutput: byteLimited("Expected output").transform(normaliseNewlines),
  })
  .strict();
export type TestInput = z.infer<typeof testInputSchema>;

export const referenceSolutionInputSchema = z
  .object({
    language: z.enum(LANGUAGES),
    source: z.string().min(1, "Source is required").max(64 * 1024),
  })
  .strict();
export type ReferenceSolutionInput = z.infer<typeof referenceSolutionInputSchema>;

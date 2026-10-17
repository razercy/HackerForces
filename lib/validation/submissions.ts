import { z } from "zod";
import { LANGUAGES } from "@/lib/languages";
import { MAX_SOURCE_BYTES, SUBMISSION_KINDS } from "@/lib/submissions";

/** The source is stored byte-for-byte as submitted: no trimming or newline normalisation. */
export const submissionInputSchema = z
  .object({
    label: z.string().trim().toUpperCase().regex(/^[A-Z][0-9]?$/),
    language: z.enum(LANGUAGES),
    kind: z.enum(SUBMISSION_KINDS).default("submission"),
    source: z
      .string()
      .refine((s) => s.trim().length > 0, "Source is empty")
      .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_SOURCE_BYTES, `Source exceeds ${MAX_SOURCE_BYTES / 1024} KB`),
    /** Editor session and the client seq of its `submit` event. */
    ideSessionId: z.uuid().optional(),
    ideSeq: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
export type SubmissionInput = z.infer<typeof submissionInputSchema>;

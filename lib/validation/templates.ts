import { z } from "zod";

const source = z
  .string()
  .refine((s) => s.trim().length > 0, "Template is empty")
  .refine((s) => Buffer.byteLength(s, "utf8") <= 64 * 1024, "Template exceeds 64 KB");

export const templateInputSchema = z.object({ name: z.string().trim().min(1).max(80), source }).strict();
export const templateVersionSchema = z.object({ source }).strict();
export const snippetInputSchema = z.object({ name: z.string().trim().min(1).max(80), source }).strict();

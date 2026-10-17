import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/server/errors";

/** Uniform JSON error responses for Route Handlers. Never leaks internal error details. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid request", issues: z.flattenError(err).fieldErrors } },
      { status: 400 },
    );
  }
  console.error(err);
  return Response.json({ error: { code: "INTERNAL", message: "Internal server error" } }, { status: 500 });
}

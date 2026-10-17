import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/server/errors";

/**
 * For page loads: missing *and* forbidden both render 404, so a page never
 * confirms that a resource the viewer may not see exists.
 */
export async function loadOr404<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === "UNAUTHENTICATED") redirect("/sign-in");
      if (err.code === "NOT_FOUND" || err.code === "FORBIDDEN") notFound();
    }
    throw err;
  }
}

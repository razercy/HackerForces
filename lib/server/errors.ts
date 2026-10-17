/** Errors that services throw and entry points (Route Handlers, Server Actions) translate. */
export class AppError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Sign in required", 401);
export const forbidden = () => new AppError("FORBIDDEN", "You do not have access to this resource", 403);
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`, 404);
export const invalidInput = (message: string) => new AppError("INVALID_INPUT", message, 400);

// Client-safe submission vocabulary.

/** `submission` is judged on hidden tests and counts for standings; `sample_run` only runs the public examples. */
export const SUBMISSION_KINDS = ["submission", "sample_run"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

/** `failed` = the platform could not judge it (not the contestant's fault). */
export const SUBMISSION_STATUSES = ["queued", "running", "judged", "failed"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const VERDICTS = [
  "accepted",
  "wrong_answer",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "runtime_error",
  "compilation_error",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  time_limit_exceeded: "Time limit exceeded",
  memory_limit_exceeded: "Memory limit exceeded",
  runtime_error: "Runtime error",
  compilation_error: "Compilation error",
};

export const MAX_SOURCE_BYTES = 64 * 1024;

export const isTerminal = (s: SubmissionStatus) => s === "judged" || s === "failed";

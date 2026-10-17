// Client-safe review vocabulary. Labels are deliberately neutral.

export const REVIEW_OUTCOMES = ["no_concern", "inconclusive", "confirmed_violation"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  no_concern: "No concern",
  inconclusive: "Inconclusive",
  confirmed_violation: "Confirmed violation (requires admin confirmation)",
};

export type CaseStatus = "open" | "awaiting_confirmation" | "closed";
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Requires review",
  awaiting_confirmation: "Awaiting second confirmation",
  closed: "Closed",
};

export const BAND_LABELS = {
  elevated: "Elevated anomaly score — requires review",
  typical: "Typical",
  insufficient_data: "Insufficient data",
} as const;

export const MIN_RATIONALE = 30;

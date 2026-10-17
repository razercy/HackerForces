/** Supported submission languages. Client-safe. */
export const LANGUAGES = ["cpp17"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  cpp17: "C++17 (GCC)",
};

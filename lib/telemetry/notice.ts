// Client-safe. The notice text is versioned: changing what is recorded means
// bumping TELEMETRY_NOTICE_VERSION, which requires every participant to
// acknowledge the new version before they can open the editor or submit.

export const TELEMETRY_NOTICE_VERSION = "2026-10-17.v1";

export const TELEMETRY_NOTICE = {
  version: TELEMETRY_NOTICE_VERSION,
  title: "Coding activity recording",
  summary:
    "This contest uses an instrumented editor. While you work in the HackerForces editor, your editing activity is recorded to help human reviewers check contest integrity.",
  recorded: [
    "Each edit you make in the contest editor: whether it was typed, pasted, dropped, auto-completed, deleted, undone or redone, its size and position, and when it happened.",
    "Periodic copies of the code in the editor (about every 30 seconds while you edit, and whenever you run or submit).",
    "When the editor gains or loses focus, and when the contest tab is hidden or shown.",
    "When you run examples or submit, and the exact code of every run and submission.",
    "Your browser's user-agent string and the time difference between your device clock and our server.",
  ],
  notRecorded: [
    "Your clipboard. Only what you actually insert into the editor becomes part of the record.",
    "Keystrokes, passwords or text outside the contest editor, other tabs, other websites or other applications.",
    "Your screen, camera, microphone, files or installed browser extensions.",
  ],
  use: [
    "Recorded activity is turned into behavioural features and may produce an anomaly score. A score is only a prompt for human review, never proof of misconduct, and never leads to an automatic penalty.",
    "Pasting code, using templates or permitted tools is not treated as cheating by itself.",
  ],
  access: "Only integrity reviewers and administrators can see recorded activity. Problem setters and other contestants cannot.",
  retention: "Raw activity events and periodic code copies are deleted after 180 days. Submissions, extracted features and review decisions are kept as contest records.",
} as const;

# Demo script

A walkthrough of HackerForces in about ten minutes: a contestant solves a problem in
the instrumented editor, then a reviewer and an admin take an integrity case from
score to decision. Every contestant and case in the integrity part is **synthetic**.

The story to tell: the platform records editor activity openly, turns it into
explainable signals, and leaves every decision to people, with a second person
required before anything affects a contestant.

## Setup (once, on a development branch)

1. Prepare a Neon **dev branch** and `.env.local` as in the [README](../README.md#local-development),
   including `SEED_DEMO_PASSWORD`.
2. Seed the accounts, the live Demo Round, and the finished synthetic contest:
   ```bash
   npm run db:migrate
   npm run seed
   npm run seed:demo
   ```
   `seed:demo` makes thousands of small writes; over a slow connection it can take
   tens of minutes. It runs once per branch.
3. Start the app with `npm run dev` and open http://localhost:3000.

The judge can be the mock (default) or a real Judge0 VM (`JUDGE_PROVIDER=judge0`, see
[judge.md](judge.md)). The editor looks the same either way.

| Account | Role in the demo |
| --- | --- |
| `contestant@demo.test` | A contestant in the live Demo Round |
| `reviewer@demo.test` | Integrity reviewer |
| `admin@demo.test` | The second person who confirms or rejects violation decisions |
| `synthetic-09@demo.test` | A synthetic contestant with a confirmed violation |

All of them use `SEED_DEMO_PASSWORD`. Use a private window per account, or sign out
between steps.

The integrity data changes as you act on it (a confirmed decision stays confirmed).
To run the demo again from the same starting point, re-seed on a fresh dev branch.

## 1. Consent before code (contestant, 1 min)

Sign in as `contestant@demo.test` and open **Contests → Demo Round**.

![Registration with the activity-recording notice](screenshots/01-registration-notice.png)

- The notice says exactly what is recorded (edits, focus, periodic code copies) and,
  just as clearly, what is **not**: the clipboard, other tabs, the screen.
- Registration is blocked until the contestant ticks the box. The app stores who
  accepted which version and when; changing the notice forces a new acceptance.

Tick the box and press **Register**.

## 2. The instrumented editor (contestant, 2 min)

Open problem **A. Sum of Two**.

![The editor with the recording indicator and a verdict](screenshots/02-editor-verdict.png)

- Point at the **"Activity in this editor is recorded"** indicator. It is always
  visible while the editor is open, and it links back to the notice.
- Type a solution, press **Run examples** (Ctrl/⌘ + Enter), then **Submit**
  (Ctrl/⌘ + Shift + Enter). The verdict appears below the editor:
  queued → running → judged.
- Contestant code never runs in the web app. It goes to the judge VM (or the mock judge,
  which never executes code at all). (The screenshot's verdict came from the mock judge.)

Optional: **Templates** shows the personal template library. Templates are versioned
and frozen when a contest starts, so pasting your own registered code is never
counted against you.

## 3. The review queue (reviewer, 1 min)

Sign in as `reviewer@demo.test` and open **Review → All assessments**.

![All assessments for the synthetic contest](screenshots/03-assessments.png)

- Each contestant and problem has one latest assessment: a score and a band, or
  "insufficient data" when telemetry is too thin to judge.
- The banner is on every review page: scores describe how code appeared in the editor;
  they are prompts for review, not evidence.
- Three subjects are **elevated**. Elevated scores open a case automatically; anyone
  else can be opened by hand.

## 4. A case, from evidence to decision (reviewer, 3 min)

Open **Cases → Synthetic Contestant 11** (status *Requires review*).

![Why this score](screenshots/04-case-score.png)

- **Data-quality warnings come first** (none here). Missing events, gaps or a
  mismatched snapshot would be listed before any score.
- **Why this score** gives every signal with its value, the cohort reference
  (median and robust z over the other 11 contestants), its weight and its points.
  Nothing is hidden in a model.
- Below it: templates in effect, the editor timeline, code evolution and submissions.

For a clearer timeline, open the closed case for **Synthetic Contestant 09**:

![Editor activity for a paste case](screenshots/05-case-timeline.png)

- About 30 characters typed, the editor loses focus, two minutes without activity,
  then 371 characters arrive in one paste and are submitted a second later.

Back on Contestant 11's case, record a decision with a rationale of at least 30 characters.
- **No concern** or **inconclusive** closes the case.
- **Confirmed violation** does *not* take effect yet: it waits for a different admin.

The reviewer cannot confirm their own decision. The database enforces this too.

## 5. Two people, then consequences (admin, 2 min)

Sign in as `admin@demo.test` and open the case for **Synthetic Contestant 10** (status
*Awaiting second confirmation*).

![A decision waiting for a second person](screenshots/06-two-person-confirmation.png)

- Contestant 10's score is **typical (1)**. The scorer misses steady auto-typing (see
  [evaluation.md](evaluation.md)), and a reviewer opened this case by hand. A low score
  is not a clearance.
- **Confirm** makes the decision take effect; **Reject** returns the case to review.
  Either way, the reason is recorded.

Then open **Integrity Demo Round (synthetic) → Standings**:

![Standings with one excluded problem](screenshots/07-standings.png)

- Only the two-person-confirmed violation is excluded (✕ on Contestant 09's problem A,
  marked †). Undecided or single-person decisions change nothing.
- If you confirmed Contestant 10's case a moment ago, it now shows too.

## 6. The contestant's side (1 min)

Sign in as `synthetic-09@demo.test` and open **Integrity Demo Round (synthetic) →
Integrity review decisions** (`/contests/integrity-demo/integrity`).

- The notice is neutral: the outcome, the reviewer's rationale, and a form for a
  written response. Contestant 09's response is already there.
- Contestants never see scores, signals or other contestants' data.

## 7. Accountability (admin, 30 s)

As an admin, open **Audit**. Every role grant, decision, confirmation and response is
in an append-only log; the database rejects edits and deletions. **Ops** shows judge
reachability and the health of both queues.

## Points to make honestly

- **The data is synthetic.** Contestants, timelines and decisions come from labelled
  scenarios in `eval/`. The scores show how the system behaves, not how real
  contestants behave.
- **It misses things by design.** Steady auto-typing and natural-rhythm retyping of
  copied code are not detected; see the failure analysis in [evaluation.md](evaluation.md).
- **It flags innocent behaviour.** Contestant 08 drafted offline and pasted the result:
  elevated (84), reviewed, closed as *inconclusive*. That is why a human decides.
- **Telemetry is client-side.** It can be incomplete or manipulated; the data-quality
  warnings exist for that reason.

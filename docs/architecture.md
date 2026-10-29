# HackerForces architecture

HackerForces is a competitive programming platform with an instrumented browser
IDE and a behavioural anomaly-detection pipeline that **assists human
reviewers**. Model output is evidence for review, never an automatic verdict of
misconduct.

## Deployment boundary

| Component | Where it runs | Why |
| --- | --- | --- |
| UI, auth, contests/problems, submissions API, telemetry ingestion, reviewer dashboard | **Vercel**: one Next.js 16 App Router project, Node.js runtime | Ordinary request/response work; stateless functions plus Postgres |
| Feature extraction + baseline scorer | **Vercel** (TypeScript, deterministic), started from the job queue | Cheap and bounded per session; no native deps |
| Postgres | **Neon** (managed, serverless, branchable) | Durable state, job queue, audit trail |
| Code judge | **External**: an isolated VM running a sandboxed judge (for example Judge0 ≥ 1.13.1 behind its own firewall), or the **mock judge** in development | Contestant code is untrusted. It never runs inside a Vercel function or any process that holds app secrets |
| Offline ML evaluation (Isolation Forest, supervised baselines, metrics) | **Local / CI**: Python scripts in `ml/` | Research and evaluation only. Not on the request path, and no Python on Vercel |

Vercel limits that drive the design (check against current Vercel docs before
relying on exact numbers):
- Request bodies are capped at about 4.5 MB, so telemetry is sent in small batches (≤ 256 KB) every few seconds.
- Function duration is bounded, so no request waits on judging. Jobs are persisted and finished asynchronously.
- Instances are ephemeral, so there is no in-memory state, queue, or lock. All of it lives in Postgres.
- Hobby-plan cron runs at most daily, so judging uses a judge callback (webhook) plus on-read reconciliation rather than frequent cron.

## Code layout

```
app/                      pages, layouts, Route Handlers (app/api/*)
components/               reusable UI (client components marked "use client")
lib/auth/roles.ts         role → permission model (pure, client-safe)
lib/validation/           Zod input schemas shared by entry points
lib/server/               server-only: env, db, auth, authz, services, audit
  env.ts                  lazily validated environment (Zod)
  db/                     Drizzle schema + node-postgres pool
  auth/                   Better Auth factory (createAuth) + app instance
  authz.ts                getCurrentUser / requireUser / requirePermission
  services/               business logic; takes a `Db` so tests can inject PGlite
drizzle/                  SQL migrations (generated + hand-written)
scripts/                  operator scripts (role bootstrap)
tests/unit, tests/integration
docs/
```

Every module under `lib/server/` imports `server-only`. Importing one from a
client component fails the build, so database clients and secrets cannot leak
into client bundles.

## Key decisions

**Drizzle ORM (0.45) instead of Prisma.** On npm, Prisma's `latest` tag
currently points at an 8.0 release candidate. Drizzle is stable, has no engine
binary, keeps cold starts small, and stays close to SQL. That matters for
idempotent telemetry ingestion (`INSERT … ON CONFLICT DO NOTHING`), `FOR UPDATE
SKIP LOCKED` job claiming, and hand-written triggers. The cost is less
generated tooling than Prisma and more SQL fluency needed from contributors.

**`pg` (node-postgres) + `attachDatabasePool` instead of the Neon WebSocket driver.**
It works with Neon's pooled endpoint and with any local Postgres. It supports
real interactive transactions, and on Vercel Fluid compute the pool is reused
across requests and drained before suspension.

**Better Auth (1.7) instead of Auth.js.** Auth.js v5 is still a beta. Better Auth is
stable, supports Next 16, has a first-party Drizzle adapter, and handles
credential hashing, sessions, and rate limiting.

**Roles live in `user_role`, not on the auth user record.** No Better Auth endpoint
(sign-up, update-user) can write them. Every signed-in user is implicitly a
`contestant`. Elevated roles are `admin`, `problem_setter`, and `reviewer`, and
they combine. Reviewers cannot edit problems. Problem setters cannot see
integrity data. Roles are re-read from the database on every request, never
taken from a cookie or the client.

**Audit log is append-only in the database.** A trigger rejects `UPDATE`/`DELETE`.
The single exception is the FK action that nulls `actor_id` when an account is
deleted.

**`cacheComponents` is off.** Nearly every page is per-user. It can be revisited
during UI polish.

## Submissions and judging

```
POST /api/contests/:slug/submissions
  └─ tx: INSERT submission (immutable source + sha256)  +  INSERT judge_job
  └─ 201 {id}  →  after(): drainJobs()           ← latency optimisation only
GET /api/submissions/:id   (client polls)
  └─ if job claimable (pending, or lease expired) → after(): drainJobs()
GET /api/cron/judge        (Vercel Cron, Bearer CRON_SECRET) → drainJobs()   ← safety net
```

- **Durable queue in Postgres.** `judge_job` rows are claimed with
  `SELECT … FOR UPDATE SKIP LOCKED` and a 60 s lease. A function that dies
  mid-job simply lets the lease expire, and the next poll or cron run reclaims
  it. Nothing is held in memory.
- **Fencing.** `attempts` is incremented on every claim, and results are written
  only `WHERE attempts = <my attempt> AND status = 'claimed'`. A slow worker
  whose lease was taken over cannot overwrite the newer attempt's verdict.
- **Retries.** Infrastructure errors (`JudgeUnavailableError`, timeouts) retry
  with exponential backoff (5 s, 10 s, …). After 3 attempts the job is marked
  dead and the submission becomes `failed`, which is shown as a judge error and
  never counts against the contestant.
- **Immutability.** A trigger rejects any UPDATE to the submitted columns and
  any DELETE. A CHECK constraint requires `source_sha256 = sha256(source)`, so
  the stored hash always matches the stored bytes.
- **Throttles.** At most one submission per 5 s and 3 pending per user per
  contest. Both are checked while holding the participant row lock, so they
  are race-free.
- **The mock judge never runs code.** It derives a verdict from the source text
  (`// @mock-verdict wrong_answer test=3`, a missing `main` gives a compilation
  error, anything else is accepted). The real judge is a separate
  `JudgeProvider` that talks to an isolated sandbox (Phase 7).
- **Hidden tests leave the database only to go to the judge.** Contestants see
  the verdict, counts and the ordinal of the first failing test, never test
  data.
- **Vercel note.** Hobby-plan cron runs daily, so the cron is only a backstop.
  Normal latency comes from `after()` plus poll-triggered recovery.

## Editor telemetry

**Consent.** `lib/telemetry/notice.ts` holds a versioned, plain-language notice
listing what is recorded, what is not, how it is used, who sees it and how long
it is kept. Registering requires ticking the box. The server checks both the tick
and the notice version, then writes an append-only `telemetry_acknowledgement`
row (user, contest, version, time). If the notice version changes, existing
participants must accept again before the editor opens or a submission is
accepted. While the editor is mounted, a recording indicator is always visible.

**What the client records** (`lib/telemetry/recorder.ts`, schema v1 in `lib/telemetry/events.ts`):

| Event | Contents |
| --- | --- |
| `edit` | One per CodeMirror transaction: origin from the `userEvent` annotation (`input.type`, `input.paste`, `input.drop`, `input.complete`, `delete`, `undo`, `redo`, …), number of ranges, first position, inserted/deleted character counts, inserted lines, document length. **Never the text itself.** |
| `snapshot` | Full editor contents: initially, every 30 s or 50 edits while changing, before each run or submit, and on unload. Stored in `code_snapshot`; the event keeps only `{reason, sha256, bytes}`. |
| `focus` / `blur` / `visibility` | Editor focus and the page's own visibility state. |
| `heartbeat` | Every 30 s while visible. Lets reviewers tell "idle" apart from "telemetry missing". |
| `run` / `submit` | Markers. The submission row stores `ide_session_id` and the marker's `seq`. |

The recorder does not read the clipboard (pasted text enters the record only
because it lands in the editor and then appears in snapshots), and it observes
nothing outside the editor. Client data can be forged, so it is treated as
evidence, never as proof.

**Delivery.** Events get strictly increasing `seq` values per session. They are
batched every 5 s or 100 events (≤ 56 KB), mirrored to a localStorage outbox,
flushed with `fetch` keepalive when the page is hidden or closed, and retried
with exponential backoff. Outboxes left behind by closed tabs are re-sent on the
next page load.

**Ingestion** (`lib/server/telemetry/ingest.ts`) is idempotent. `(session_id,
seq)` is the primary key and inserts use `ON CONFLICT DO NOTHING`, so retried,
duplicated and out-of-order batches are all safe. The session row is locked to
assign an `arrival` number, which keeps reordering visible. Each batch is
limited to 200 events and 100 KB, each session to 50 000 events, and late
flushes are accepted for up to 15 minutes after the contest ends. Writing to
another user's session returns 404.

**Data quality** (`lib/telemetry/quality.ts`) produces warnings that travel with
the timeline: missing sequence ranges, out-of-order delivery, gaps while the page
was visible, client clock skew, missing pre-submit snapshots, and submitted code
that differs from the pre-submit snapshot. A missing or broken session is
reported as missing data; it is never treated as suspicious in itself.

**Access and retention.** Only `integrity:review` (reviewers and admins) can read
timelines. Problem setters and contestants cannot. `/api/cron/retention` deletes
raw events and snapshots after `TELEMETRY_RETENTION_DAYS` (default 180) and keeps
session rows marked `purged_at`. Submissions are contest records and are not
affected.

## Security controls (summary)

| Concern | Control | Where |
| --- | --- | --- |
| Untrusted code | Never executed in the app; mock judge, or Judge0 on an isolated VM | `lib/server/judge/*`, `infra/judge`, [judge.md](judge.md) |
| XSS | Nonce-based CSP (`script-src 'nonce-…' 'strict-dynamic'`), React escaping, Markdown without raw HTML | `proxy.ts`, `components/markdown.tsx` |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `proxy.ts`, `next.config.ts` |
| CSRF | Same-origin check on JSON mutations; Next.js origin check for Server Actions; Better Auth `trustedOrigins`; `SameSite=Lax` cookies | `lib/server/origin.ts` |
| Brute force / abuse | DB-backed auth rate limits (shared across instances); submission and telemetry throttles and quotas | `create-auth.ts`, services |
| Authorization | Server-side permission checks in every service; ownership and separation of duties; reviewer-only telemetry | `lib/auth/roles.ts`, services |
| Integrity of records | Append-only triggers on audit log, submissions, decisions, acknowledgements, assessments | `drizzle/*.sql` |
| Secrets | Env validation; HTTPS-only judge URL; nothing secret in client bundles (`server-only`) | `lib/server/env.ts` |
| Privacy | Versioned consent notice, `Permissions-Policy: clipboard-read=()`, 180-day telemetry retention | `lib/telemetry/notice.ts` |

Known dependency advisory: `npm audit` reports a moderate issue in an old
esbuild pulled in by **drizzle-kit** (dev-only migration tooling, affecting
esbuild's dev server). It is not part of the deployed app. The suggested fix
would downgrade drizzle-kit, so it is tracked rather than forced.

## Testing

- `tests/unit`: pure logic, such as the permission matrix.
- `tests/integration`: services and Better Auth against **PGlite** (Postgres
  compiled to WASM, in process). Each test file gets a fresh database with the
  real migrations applied, so no Docker or network is needed.
- Later: Playwright end-to-end tests against `next dev` and a Neon test branch.

PGlite is real Postgres, but it is single-connection. Behaviour that depends on
concurrency, such as `SKIP LOCKED` races, must also be checked against a real
server (a Neon branch) before it can be called verified.

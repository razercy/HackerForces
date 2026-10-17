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

## Testing

- `tests/unit`: pure logic, such as the permission matrix.
- `tests/integration`: services and Better Auth against **PGlite** (Postgres
  compiled to WASM, in process). Each test file gets a fresh database with the
  real migrations applied, so no Docker or network is needed.
- Later: Playwright end-to-end tests against `next dev` and a Neon test branch.

PGlite is real Postgres, but it is single-connection. Behaviour that depends on
concurrency, such as `SKIP LOCKED` races, must also be checked against a real
server (a Neon branch) before it can be called verified.

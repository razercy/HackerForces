# Roadmap

Each phase ends with a working, tested increment. Commits are made manually by the maintainer.

| # | Phase | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 0 | Inspection & architecture | Stack chosen and justified; Vercel/external boundary documented | Done |
| 1a | **Foundation** | Next 16 + strict TS + Tailwind; validated env; Drizzle schema + migrations; Better Auth email/password; RBAC (`user_role`) with server-side checks; append-only audit log; PGlite-backed integration tests; lint, typecheck, test and build all green | **This milestone** |
| 1b | Seed & admin bootstrap on Neon | `db:migrate` against a Neon dev branch; seed script creates demo admin, setter, reviewer, contestant; `/api/health` is ok against Neon | Next |
| 2 | Contests, problems, submissions, judge | Setter creates a contest and problem (statement, limits, examples, hidden tests, reference solution); contestant registers; `JudgeProvider` interface with a **mock judge**; submission stores an immutable snapshot (SHA-256 content hash; no UPDATE path) and a `judge_job` row; states go queued → running → verdict; history and a basic leaderboard. Tests cover transitions, immutability, and hidden-test access control | |
| 3 | Instrumented IDE + telemetry | Monaco C++ editor; versioned event schema (Zod); batched uploads with session id + sequence numbers; idempotent ingest (`UNIQUE(session_id, seq)`); tolerates reordering and gaps; periodic snapshots; disclosure notice; registered templates. Tests cover duplicates, out-of-order delivery, and oversize batches | |
| 4 | Features + baseline scorer | Deterministic, versioned feature extraction (paste-size distribution, typing burst variability, edit gaps, compile/debug cadence, template-similarity discount, time-to-AC per difficulty); robust z-score baseline per problem cohort; assessment = score + evidence + feature values + data-quality warnings + ruleset version; DB job queue (`FOR UPDATE SKIP LOCKED`) | |
| 5 | Reviewer dashboard | Queue with filters; event timeline; snapshot diffs; compile history; feature explanations; neutral labels; decisions with a mandatory rationale; audit trail. Contestants and setters get 403 on every review route | |
| 6 | Evaluation | Python `ml/` with clearly labelled **synthetic** scenarios (ordinary, template, large legitimate paste, compile/debug loops, simulated insertion); session-aware splits; precision/recall/F1/PR-AUC/FPR/review-load; baseline vs Isolation Forest; documented failure cases and limits | |
| 7 | Security & reliability | External judge on an isolated VM (CPU/mem/wall/pids/fs/network limits, no secrets, signed callbacks); rate limits; retention policy for telemetry; Vercel deploy verified | |
| 8 | Polish & portfolio | UI polish, accessibility pass, demo script, README walkthrough, screenshots | |

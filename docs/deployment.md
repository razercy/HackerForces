# Deploying HackerForces

The web application is **one Next.js project on Vercel**. Postgres is **Neon**.
Contestant code runs only on the **separate judge VM** ([docs/judge.md](judge.md)),
or nowhere at all while `JUDGE_PROVIDER=mock`.

| Component | Where | Notes |
| --- | --- | --- |
| UI, API, auth, telemetry ingestion, integrity scoring, review | Vercel (Node.js runtime, Fluid compute) | Stateless. Background work runs via `after()`, status polls and cron, all backed by Postgres queues |
| Database | Neon Postgres (pooled connection string) | Separate branches for Production, Preview and local development |
| Judge | Judge0 CE on a dedicated VM | Optional. The mock judge needs no infrastructure |
| Offline evaluation | Your machine or CI (`ml/`) | Not deployed |

## 1. Prepare Neon

1. Create a **production** branch and a **preview** branch, and copy each branch's
   *pooled* connection string.
2. Apply the migrations to each branch. Run this from your machine with that branch's
   `DATABASE_URL` set:
   ```bash
   npm run db:migrate
   ```

## 2. Create the Vercel project

1. **Import the repository** in Vercel. Use the "Next.js" framework preset and leave
   the build settings at their defaults (`next build`).
2. **Set environment variables** under Settings → Environment Variables, separately
   for Production and Preview:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled URL for that environment |
   | `BETTER_AUTH_SECRET` | Different random value per environment (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
   | `BETTER_AUTH_URL` | `https://<your-domain>`. Preview deployments get their own origin, so set it per preview domain or use a stable preview domain |
   | `CRON_SECRET` | Random string of 16+ characters. Vercel Cron sends it automatically |
   | `JUDGE_PROVIDER` | `mock` until the judge VM passes `npm run judge:check`, then `judge0` |
   | `JUDGE0_URL`, `JUDGE0_AUTH_TOKEN` | Only with `JUDGE_PROVIDER=judge0` |
   | `TELEMETRY_RETENTION_DAYS` | Optional, defaults to 180 |

3. **Deploy.** `vercel.json` registers three daily crons: judge safety-net,
   telemetry retention, and integrity re-scoring. On the Hobby plan crons run at
   most once a day, which is fine because they are only backstops.

## 3. Bootstrap and verify

1. Sign up on the deployed site, then grant yourself admin. Run this from your
   machine, in the repository, with the production `DATABASE_URL` set in the shell
   only for this command (PowerShell shown):
   ```powershell
   $env:DATABASE_URL = "<production pooled URL>"; npm run grant-role -- you@example.com admin; Remove-Item Env:DATABASE_URL
   ```
   The script also loads `.env.local`, because environment validation needs the
   other server variables. A variable set in the shell always takes precedence, so
   the command writes to the production branch, not your development one. It prints
   the account's roles. Sign out and back in for the new role to apply.
2. Run the smoke test against the deployment. It is read-only:
   ```bash
   node scripts/smoke.mjs https://<your-domain>
   ```
   It checks:
   - the health and database connection;
   - CSP with a fresh nonce and no `unsafe-eval`;
   - the security headers, including HSTS on HTTPS;
   - authentication on APIs and review pages;
   - rejection of cross-origin POSTs;
   - cron protection;
   - `no-store` on API responses.
3. Open `/admin/ops` as an admin. The judge provider should be shown and the queues
   should be empty.

## Operational notes

- **Function duration:** submission and status routes set `maxDuration = 120`.
  Background drains are budgeted to finish well inside it: 20 s of claims plus a
  45 s judge timeout.
- **Request limits:** Vercel caps request bodies at about 4.5 MB. Our largest
  bodies are well below it: a submission is at most 80 KB, a telemetry batch at
  most 100 KB, and a hidden test at most 256 KB per field (sent through Server
  Actions, whose 1 MB default limit stays in place).
- **Rate limits** for sign-in and sign-up are stored in Postgres, so they hold
  across serverless instances.
- **Security headers:** CSP is set per request in `proxy.ts`. Static headers are
  set in `next.config.ts`.
- **Do not seed production.** `npm run seed` refuses to run when
  `NODE_ENV=production`; never point it at the production branch.

## Verified so far

- A production build (`next build && next start`) passes `scripts/smoke.mjs` locally
  against the Neon dev branch, except for the HSTS check, which only applies over HTTPS.
- **Vercel production, 2026-10-31** (`https://hacker-forces.vercel.app`):
  - functions run in `sin1` (Singapore). The Neon project is in `ap-southeast-2`
    (Sydney), so `syd1` would put the functions next to the database;
  - `scripts/smoke.mjs` passes all 17 checks, including HSTS;
  - the admin bootstrap with `grant-role` works;
  - `/admin/ops` shows `judge0` as reachable, with no dead jobs in either queue;
  - a real C++17 submission was judged Accepted (3/3 hidden tests) by the Judge0 VM.
- **Choose the function region to match the database.** The default (`iad1`) puts
  every query on a long round trip if the database is in Asia. Set it under
  Settings → Functions to the Vercel region nearest your Neon project, and keep
  the judge VM nearby too.

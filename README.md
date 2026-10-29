# HackerForces

A competitive programming platform with an instrumented browser IDE and a
transparent, human-in-the-loop behavioural anomaly review system.

> Anomaly scores are review aids, not proof of misconduct. Nothing in this
> system penalises a contestant automatically.

- Architecture and deployment boundary: [docs/architecture.md](docs/architecture.md)
- Roadmap and acceptance criteria: [docs/roadmap.md](docs/roadmap.md)

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS 4 · Drizzle ORM ·
PostgreSQL (Neon) · Better Auth · Zod · Vitest + PGlite. The app deploys to
Vercel as a single project.

## Local development

Requires Node.js 22 or later.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a **dev branch** in your Neon project and copy its *pooled* connection string.
3. Create `.env.local` from `.env.example`, then fill in `DATABASE_URL` and a random `BETTER_AUTH_SECRET`.
4. Apply migrations:
   ```bash
   npm run db:migrate
   ```
5. Start the app:
   ```bash
   npm run dev
   ```
   Then open http://localhost:3000 and create an account.
6. Make yourself an admin:
   ```bash
   npm run grant-role -- you@example.com admin
   ```
7. Optionally, seed demo data. First set `SEED_DEMO_PASSWORD` in `.env.local`, then run:
   ```bash
   npm run seed
   ```
   This creates `setter@demo.test`, `reviewer@demo.test`, `admin@demo.test` and `contestant@demo.test`, plus a published "Demo Round" contest that starts one minute after seeding. Running it again is safe.

## Checks

The test suite runs against an in-process Postgres (PGlite) and needs no database, Docker, or `.env`.

```bash
npm run check
```

```bash
npm run build
```

## Evaluation on synthetic data

The evaluation runs offline and is not part of the deployed app. It needs Python 3.12 or later.

1. Create the virtual environment:
   ```bash
   python -m venv ml/.venv
   ```
2. Install the pinned dependencies. On Windows:
   ```bash
   ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
   ```
   On macOS or Linux:
   ```bash
   ml/.venv/bin/python -m pip install -r ml/requirements.txt
   ```
3. Generate the dataset, then evaluate and write `docs/evaluation.md`:
   ```bash
   npm run eval
   ```
4. Run the Python tests:
   ```bash
   npm run eval:test
   ```

All of the evaluation data is **synthetic**. See [docs/evaluation.md](docs/evaluation.md) for what the results do and do not mean.

## Deploying to Vercel

See [docs/deployment.md](docs/deployment.md) for environment variables, migrations, crons and the post-deploy smoke test. See [docs/judge.md](docs/judge.md) for setting up the isolated Judge0 VM and its threat model. The app stays on the safe mock judge until a judge VM has been provisioned and verified.

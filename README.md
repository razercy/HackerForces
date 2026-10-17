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

## Deploying to Vercel

1. Import the repository into Vercel. Use the Next.js framework preset with default build settings.
2. Add the Neon integration from the Vercel Marketplace, or set `DATABASE_URL` manually using the pooled string from your production branch.
3. Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (`https://<your-domain>`) for Production. Use separate values for Preview.
4. Run `npm run db:migrate` against the production branch before or as part of each release.
5. Check that `GET /api/health` returns `{"status":"ok"}`.

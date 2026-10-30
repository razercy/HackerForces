import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import * as schema from "@/lib/server/db/schema";
import { SYSTEM, grantRole, revokeRole } from "@/lib/server/services/roles";
import { insertUser } from "../helpers/db";

/**
 * Real lock-contention tests for the last-admin invariant. PGlite has one connection and cannot
 * interleave transactions, so these need a real PostgreSQL server with independent connections.
 *
 * Opt-in and skipped by default. Point TEST_POSTGRES_URL at an EMPTY, disposable, local database
 * (localhost only; the migrations are applied to it):
 *   TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/hf_concurrency npx vitest run tests/integration/roles-concurrency.pg.test.ts
 */
const url = process.env.TEST_POSTGRES_URL;
const isLocal = (u: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname);

describe.skipIf(!url)("last-admin invariant under real PostgreSQL concurrency", () => {
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    if (!isLocal(url!)) throw new Error("TEST_POSTGRES_URL must point at a local, disposable database");
    pool = new Pool({ connectionString: url, max: 10 });
    const pg = drizzle({ client: pool, schema });
    await migrate(pg, { migrationsFolder: "./drizzle" });
    db = pg as unknown as Db;
  });
  afterAll(async () => pool?.end());

  /** Starts from exactly the given admins. Audit rows are append-only, so earlier ones are kept. */
  async function onlyAdmins(n: number) {
    await db.delete(schema.userRole).where(eq(schema.userRole.role, "admin"));
    const users = [];
    for (let i = 0; i < n; i++) {
      const u = await insertUser(db);
      await grantRole(db, SYSTEM, u.id, "admin");
      users.push(u);
    }
    return users;
  }
  const adminIds = async () => (await db.select().from(schema.userRole).where(eq(schema.userRole.role, "admin"))).map((r) => r.userId);

  /** Waits until some backend is blocked on a lock (the service call queued behind the competing transaction). */
  async function waitForLockWait() {
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from pg_locks where not granted");
      if (rows[0]!.n > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("revokeRole never blocked on the competing transaction's row locks");
  }

  /** Holds a competing revocation of `victim` open (same statements as revokeRole) while `run` executes. */
  async function withCompetingRevocation(victim: string, outcome: "COMMIT" | "ROLLBACK", run: () => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select user_id from user_role where role = 'admin' for update");
      await client.query("delete from user_role where user_id = $1 and role = 'admin'", [victim]);
      const pending = run();
      pending.catch(() => {}); // Asserted by the caller.
      await waitForLockWait();
      await client.query(outcome);
      return pending;
    } finally {
      client.release();
    }
  }

  it("a revocation that waited on a committed competing revocation sees the fresh admin set and refuses", async () => {
    const [a, b] = await onlyAdmins(2);
    const pending = await withCompetingRevocation(a!.id, "COMMIT", () => revokeRole(db, SYSTEM, b!.id, "admin"));
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await adminIds()).toEqual([b!.id]);
  });

  it("if the competing revocation rolls back, the waiting one proceeds", async () => {
    const [a, b] = await onlyAdmins(2);
    const pending = await withCompetingRevocation(a!.id, "ROLLBACK", () => revokeRole(db, SYSTEM, b!.id, "admin"));
    await expect(pending).resolves.toBeUndefined();
    expect(await adminIds()).toEqual([a!.id]);
  });

  it("racing revocations through the service never remove every admin", async () => {
    for (let round = 0; round < 25; round++) {
      const admins = await onlyAdmins(3);
      await Promise.allSettled(admins.map((u) => revokeRole(db, SYSTEM, u.id, "admin")));
      expect((await adminIds()).length).toBeGreaterThanOrEqual(1);
    }
  });
});

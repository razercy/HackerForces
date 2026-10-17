import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/lib/server/db";
import * as schema from "@/lib/server/db/schema";

/**
 * Fresh in-process Postgres (PGlite) with the real migrations applied.
 * Each call is fully isolated, so test files can run in parallel.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Db, close: () => client.close() };
}

let seq = 0;
export async function insertUser(db: Db, overrides: Partial<typeof schema.user.$inferInsert> = {}) {
  seq += 1;
  const [row] = await db
    .insert(schema.user)
    .values({ id: `user_${seq}_${Date.now()}`, name: `User ${seq}`, email: `user${seq}_${Date.now()}@example.test`, ...overrides })
    .returning();
  return row!;
}

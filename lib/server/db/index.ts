import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/lib/server/env";
import * as schema from "./schema";

/**
 * Driver-agnostic database type. Services accept a `Db` so they run against
 * node-postgres in the app and PGlite in tests.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

let db: Db | undefined;

export function getDb(): Db {
  if (db) return db;
  const pool = new Pool({
    connectionString: serverEnv().DATABASE_URL,
    // Small per-instance pool: Vercel Fluid reuses instances across requests,
    // and Neon's pooled (-pooler) endpoint multiplexes server-side.
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  // Lets Vercel close idle clients before an instance is suspended.
  attachDatabasePool(pool);
  db = drizzle({ client: pool, schema });
  return db;
}

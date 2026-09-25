import "server-only";
import postgres from "postgres";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

/**
 * Production (Vercel): any Postgres via DATABASE_URL (Supabase: use the
 * transaction pooler URL, port 6543).
 * Local dev without DATABASE_URL: an embedded PGlite database in ./.pglite,
 * migrated automatically, so the app runs with zero setup.
 */
async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // prepare: false is required by Supabase's transaction pooler (PgBouncer);
    // a small pool suits short-lived serverless functions.
    const client = postgres(url, { prepare: false, max: 5 });
    return drizzlePg(client, { schema });
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add it in the Vercel project settings.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite("./.pglite");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // Same query-builder API as the Neon driver for everything this app uses.
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  globalForDb.__db ??= createDb();
  return globalForDb.__db;
}

export { schema };

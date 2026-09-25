import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

/**
 * Production (Vercel): Neon Postgres via DATABASE_URL.
 * Local dev without DATABASE_URL: an embedded PGlite database in ./.pglite,
 * migrated automatically, so the app runs with zero setup.
 */
async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzleNeon(neon(url), { schema });
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Add a Neon database in the Vercel dashboard.");
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

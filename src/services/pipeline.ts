import "server-only";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { refreshSources } from "@/services/refresh";
import { buildDigests } from "@/services/digest";

/** Scrape everything linked to these locations, then rebuild their digests. */
export async function scrapeAndDigest(locationIds: number[], forceDigest = false) {
  const db = await getDb();
  const links = await db
    .select({ sourceId: schema.locationSources.sourceId })
    .from(schema.locationSources)
    .where(inArray(schema.locationSources.locationId, locationIds));
  await refreshSources({ sourceIds: links.map((l) => l.sourceId), limit: 100, budgetMs: 200_000 });
  await buildDigests(locationIds, 60_000, forceDigest);
}

import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Location, Section } from "@/db/schema";
import { restaurantsNear } from "@/scrapers/osm";
import { storesNear } from "@/scrapers/axfood";

const MAX_RESTAURANTS = Number(process.env.MAX_RESTAURANTS_PER_LOCATION ?? 25);

type SourceRow = {
  section: Section;
  provider: string;
  externalId: string;
  name: string;
  url: string | null;
  address: string | null;
  lat: number;
  lng: number;
  distanceM: number;
};

async function findRestaurants(location: Location): Promise<SourceRow[]> {
  const restaurants = await restaurantsNear(location, location.radiusM, MAX_RESTAURANTS);
  return restaurants.map((r) => ({
    section: "lunch",
    provider: "web",
    externalId: r.osmId,
    name: r.name,
    url: r.website,
    address: [r.address, r.cuisine].filter(Boolean).join(" · ") || null,
    lat: r.lat,
    lng: r.lng,
    distanceM: r.distanceM,
  }));
}

async function findStores(location: Location): Promise<SourceRow[]> {
  // Grocery stores are sparser than restaurants, so look a bit further.
  const stores = await storesNear(location, Math.min(Math.max(location.radiusM * 2, 1500), 5000));
  return stores.slice(0, 6).map((s) => ({
    section: "grocery",
    provider: s.chain,
    externalId: s.storeId,
    name: s.name,
    url: s.url,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    distanceM: s.distanceM,
  }));
}

/** Replace the location's links for one section with freshly discovered sources. */
async function linkSources(location: Location, section: Section, rows: SourceRow[]) {
  const db = await getDb();
  const sectionIds = db.select({ id: schema.sources.id }).from(schema.sources).where(eq(schema.sources.section, section));
  await db
    .delete(schema.locationSources)
    .where(and(eq(schema.locationSources.locationId, location.id), inArray(schema.locationSources.sourceId, sectionIds)));
  if (!rows.length) return;
  const inserted = await db
    .insert(schema.sources)
    .values(
      rows.map((r) => ({
        section: r.section,
        provider: r.provider,
        externalId: r.externalId,
        name: r.name,
        url: r.url,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
      })),
    )
    .onConflictDoUpdate({
      target: [schema.sources.provider, schema.sources.externalId],
      set: {
        name: sql`excluded.name`,
        url: sql`excluded.url`,
        address: sql`excluded.address`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
      },
    })
    .returning({ id: schema.sources.id, provider: schema.sources.provider, externalId: schema.sources.externalId });
  const dist = new Map(rows.map((r) => [`${r.provider}:${r.externalId}`, r.distanceM]));
  await db
    .insert(schema.locationSources)
    .values(
      inserted.map((s) => ({
        locationId: location.id,
        sourceId: s.id,
        distanceM: dist.get(`${s.provider}:${s.externalId}`) ?? 0,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Find restaurants and grocery stores around a location and link them to it.
 * If a lookup fails (public Overpass servers are often busy), existing links
 * for that section are kept and the location stays marked for re-discovery.
 */
export async function discoverForLocation(location: Location) {
  const db = await getDb();
  const [restaurants, stores] = await Promise.all([
    findRestaurants(location).catch((e) => (console.error("Restaurant discovery failed", e), null)),
    findStores(location).catch((e) => (console.error("Store discovery failed", e), null)),
  ]);
  if (restaurants) await linkSources(location, "lunch", restaurants);
  if (stores) await linkSources(location, "grocery", stores);
  if (restaurants && stores) {
    await db.update(schema.locations).set({ discoveredAt: new Date() }).where(eq(schema.locations.id, location.id));
  }
  return { restaurants: restaurants?.length ?? null, stores: stores?.length ?? null };
}

/** Locations never fully discovered, or not re-checked for a week. */
export async function locationsNeedingDiscovery(limit = 10) {
  const db = await getDb();
  return db
    .select()
    .from(schema.locations)
    .where(
      or(isNull(schema.locations.discoveredAt), lt(schema.locations.discoveredAt, new Date(Date.now() - 7 * 86400_000))),
    )
    .limit(limit);
}

import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Location, Section } from "@/db/schema";
import { fastFoodNear, restaurantsNear } from "@/scrapers/osm";
import { storesNear } from "@/scrapers/axfood";
import { chainFor } from "@/scrapers/fastfood";

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
  // Chain branches have no lunch menus of their own; they're covered by the fast food section.
  return restaurants.filter((r) => !chainFor({ name: r.name })).map((r) => ({
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

const MAX_OUTLETS = 30;

/**
 * Fast food near the location: known chains (one source per chain, distance =
 * nearest branch) plus other fast food places and food courts, such as the
 * outlets in a shopping centre food court.
 */
async function findFastFood(location: Location): Promise<SourceRow[]> {
  const places = await fastFoodNear(location, Math.min(Math.max(location.radiusM * 2, 1500), 5000));
  const chains = new Map<string, SourceRow>();
  const outlets: SourceRow[] = [];
  for (const p of places) {
    // places are sorted nearest first
    const chain = chainFor({ brand: p.brand ?? undefined, name: p.name });
    if (chain) {
      if (!chains.has(chain.id)) {
        chains.set(chain.id, {
          section: "fastfood",
          provider: "chain",
          externalId: chain.id,
          name: chain.name,
          url: chain.dealPages[0] ?? chain.homepage,
          address: null,
          lat: p.lat,
          lng: p.lng,
          distanceM: p.distanceM,
        });
      }
      continue;
    }
    if (outlets.length >= MAX_OUTLETS) continue;
    outlets.push({
      section: "fastfood",
      provider: "outlet",
      externalId: p.osmId,
      name: p.name,
      url: p.website,
      address: [p.foodCourt ? "Food court" : null, p.address, p.cuisine].filter(Boolean).join(" · ") || null,
      lat: p.lat,
      lng: p.lng,
      distanceM: p.distanceM,
    });
  }
  return [...chains.values(), ...outlets];
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
 * Find restaurants, grocery stores and fast food chains around a location and link them to it.
 * If a lookup fails (public Overpass servers are often busy), existing links
 * for that section are kept and the location stays marked for re-discovery.
 */
export async function discoverForLocation(location: Location) {
  const db = await getDb();
  const errors: string[] = [];
  const fail = (what: string) => (e: unknown) => {
    console.error(`${what} discovery failed`, e);
    // Node reports network failures as "fetch failed"; the cause says why (DNS, reset, timeout...).
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause ? ` (${cause.code ?? cause.message})` : "";
    errors.push(`${what}: ${(e as Error).message}${detail}`.slice(0, 300));
    return null;
  };
  const [restaurants, stores] = await Promise.all([
    findRestaurants(location).catch(fail("Restaurant")),
    findStores(location).catch(fail("Store")),
  ]);
  // After the restaurant lookup, so the Nominatim fallbacks don't overlap (1 request/second).
  const chains = await findFastFood(location).catch(fail("Fast food"));
  if (restaurants) await linkSources(location, "lunch", restaurants);
  if (stores) await linkSources(location, "grocery", stores);
  if (chains) await linkSources(location, "fastfood", chains);
  await db
    .update(schema.locations)
    .set({
      discoveryError: errors.length ? errors.join(" | ") : null,
      ...(restaurants && stores && chains ? { discoveredAt: new Date() } : {}),
    })
    .where(eq(schema.locations.id, location.id));
  return { restaurants: restaurants?.length ?? null, stores: stores?.length ?? null, chains: chains?.length ?? null };
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

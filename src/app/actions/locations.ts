"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { geocode } from "@/lib/geo";
import { discoverForLocation } from "@/services/discovery";
import { refreshSources } from "@/services/refresh";
import { buildDigests } from "@/services/digest";

export type LocationFormState = { error?: string; ok?: string } | undefined;

const MAX_LOCATIONS = 5;

const LocationSchema = z.object({
  label: z.string().trim().min(1, "Give the location a name, e.g. Office").max(40),
  address: z.string().trim().min(3, "Enter an address"),
  radiusM: z.coerce.number().int().min(200).max(3000),
  days: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one day"),
});

/** Scrape everything linked to these locations, then rebuild their digests. */
async function scrapeAndDigest(locationIds: number[], forceDigest = false) {
  const db = await getDb();
  const links = await db
    .select({ sourceId: schema.locationSources.sourceId })
    .from(schema.locationSources)
    .where(inArray(schema.locationSources.locationId, locationIds));
  await refreshSources({ sourceIds: links.map((l) => l.sourceId), limit: 100, budgetMs: 200_000 });
  await buildDigests(locationIds, 60_000, forceDigest);
}

export async function addLocation(_: LocationFormState, formData: FormData): Promise<LocationFormState> {
  const user = await requireUser();
  const parsed = LocationSchema.safeParse({
    label: formData.get("label"),
    address: formData.get("address"),
    radiusM: formData.get("radiusM"),
    days: formData.getAll("days"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const existing = await db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.userId, user.id));
  if (existing.length >= MAX_LOCATIONS) return { error: `You can have at most ${MAX_LOCATIONS} locations` };

  const geo = await geocode(parsed.data.address).catch(() => null);
  if (!geo) return { error: "We couldn't find that address in Sweden. Try adding the city, e.g. 'Drottninggatan 1, Stockholm'." };

  const [location] = await db
    .insert(schema.locations)
    .values({ userId: user.id, ...parsed.data, address: geo.displayName.split(",").slice(0, 3).join(","), lat: geo.lat, lng: geo.lng })
    .returning();

  const found = await discoverForLocation(location);
  // Scraping can take a few minutes; do it after responding.
  after(() => scrapeAndDigest([location.id]));
  revalidatePath("/locations");
  const count = (n: number | null, noun: string) => (n == null ? `(${noun} search is busy, we'll retry)` : `${n} ${noun}`);
  return {
    ok: `Added ${location.label}: found ${count(found.restaurants, "restaurants")} and ${count(found.stores, "grocery stores")} nearby. Fetching this week's offers now — check the dashboard in a few minutes.`,
  };
}

export async function updateLocationDays(locationId: number, days: number[]) {
  const user = await requireUser();
  const clean = [...new Set(days.filter((d) => d >= 1 && d <= 7))].sort();
  if (!clean.length) return;
  const db = await getDb();
  await db
    .update(schema.locations)
    .set({ days: clean })
    .where(and(eq(schema.locations.id, locationId), eq(schema.locations.userId, user.id)));
  revalidatePath("/locations");
  revalidatePath("/dashboard");
}

export async function deleteLocation(locationId: number) {
  const user = await requireUser();
  const db = await getDb();
  await db.delete(schema.locations).where(and(eq(schema.locations.id, locationId), eq(schema.locations.userId, user.id)));
  revalidatePath("/locations");
  revalidatePath("/dashboard");
}

/** "Refresh now" button: re-discover and re-scrape the user's own locations. */
export async function refreshMyOffers() {
  const user = await requireUser();
  const db = await getDb();
  const locs = await db.select().from(schema.locations).where(eq(schema.locations.userId, user.id));
  const linked = locs.length
    ? await db
        .select({ locationId: schema.locationSources.locationId, section: schema.sources.section })
        .from(schema.locationSources)
        .innerJoin(schema.sources, eq(schema.sources.id, schema.locationSources.sourceId))
        .where(inArray(schema.locationSources.locationId, locs.map((l) => l.id)))
    : [];
  for (const loc of locs) {
    const stale = !loc.discoveredAt || Date.now() - loc.discoveredAt.getTime() > 7 * 86400_000;
    const noRestaurants = !linked.some((l) => l.locationId === loc.id && l.section === "lunch");
    if (stale || noRestaurants) await discoverForLocation(loc);
  }
  after(() => scrapeAndDigest(locs.map((l) => l.id), true));
  revalidatePath("/dashboard");
}

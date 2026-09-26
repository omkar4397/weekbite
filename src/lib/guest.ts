import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Location } from "@/db/schema";
import { distanceM } from "@/lib/geo";

/**
 * Visitors without an account see public places owned by one "guest" user:
 * fixed demo areas plus addresses they search for. The guest user's password
 * hash is not a bcrypt hash, so nobody can log in as it.
 */
const GUEST_EMAIL = "guest@weekbite.invalid";
const GUEST_RADIUS_M = 1000;
const WEEKDAYS = [1, 2, 3, 4, 5];
/** Keep guest searches bounded: the oldest are removed beyond this. */
const MAX_GUEST_SEARCHES = 100;
/** New guest searches per hour (each one scrapes dozens of sites). */
const MAX_NEW_SEARCHES_PER_HOUR = 20;

export const FEATURED = [
  { slug: "kista", label: "Kista, Stockholm", address: "Kista Galleria, Kista, Stockholm", lat: 59.4033, lng: 17.9447 },
  { slug: "lindholmen", label: "Lindholmen, Gothenburg", address: "Lindholmspiren 5, Göteborg", lat: 57.7066, lng: 11.938 },
] as const;
const FEATURED_SLUGS = FEATURED.map((f) => f.slug);

async function guestUserId() {
  const db = await getDb();
  const [row] = await db
    .insert(schema.users)
    .values({ email: GUEST_EMAIL, name: "Guest", passwordHash: "!" })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: "Guest" } })
    .returning({ id: schema.users.id });
  return row.id;
}

/** The demo areas, created on first use, in display order. */
export async function featuredLocations(): Promise<Location[]> {
  const db = await getDb();
  let rows = await db.select().from(schema.locations).where(inArray(schema.locations.slug, FEATURED_SLUGS));
  if (rows.length < FEATURED.length) {
    const userId = await guestUserId();
    await db
      .insert(schema.locations)
      .values(FEATURED.map((f) => ({ userId, slug: f.slug, label: f.label, address: f.address, lat: f.lat, lng: f.lng, radiusM: GUEST_RADIUS_M, days: WEEKDAYS })))
      .onConflictDoNothing();
    rows = await db.select().from(schema.locations).where(inArray(schema.locations.slug, FEATURED_SLUGS));
  }
  return FEATURED_SLUGS.map((s) => rows.find((r) => r.slug === s)!).filter(Boolean);
}

export async function locationBySlug(slug: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.locations).where(eq(schema.locations.slug, slug));
  return row ?? null;
}

/**
 * A public place for a searched address: reuses a guest place within 300 m,
 * otherwise creates one. Returns null when too many new searches were made this hour.
 */
export async function guestPlaceFor(geo: { lat: number; lng: number; displayName: string }) {
  const db = await getDb();
  const userId = await guestUserId();
  const mine = await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.userId, userId), notInArray(schema.locations.slug, FEATURED_SLUGS)));
  const near = mine.find((l) => distanceM(l, geo) <= 300);
  if (near) return { location: near, created: false };

  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(schema.locations)
    .where(and(eq(schema.locations.userId, userId), gt(schema.locations.createdAt, new Date(Date.now() - 3600_000))));
  if (recent >= MAX_NEW_SEARCHES_PER_HOUR) return null;

  if (mine.length >= MAX_GUEST_SEARCHES) {
    const oldest = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.userId, userId), notInArray(schema.locations.slug, FEATURED_SLUGS)))
      .orderBy(asc(schema.locations.createdAt))
      .limit(mine.length - MAX_GUEST_SEARCHES + 1);
    await db.delete(schema.locations).where(inArray(schema.locations.id, oldest.map((o) => o.id)));
  }

  const label = geo.displayName.split(",").slice(0, 2).join(",").trim();
  const [location] = await db
    .insert(schema.locations)
    .values({
      userId,
      slug: randomBytes(6).toString("hex"),
      label,
      address: geo.displayName.split(",").slice(0, 3).join(","),
      lat: geo.lat,
      lng: geo.lng,
      radiusM: GUEST_RADIUS_M,
      days: WEEKDAYS,
    })
    .returning();
  return { location, created: true };
}

import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Section of the app an offer belongs to. */
export type Section = "lunch" | "grocery" | "fastfood";
export const SECTIONS: Section[] = ["lunch", "grocery", "fastfood"];

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A place the user is usually at during the week (office, home, gym...). */
export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: text("address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radiusM: integer("radius_m").notNull().default(1000),
    /** ISO weekdays the user is here: 1 = Monday ... 7 = Sunday. */
    days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }),
    /** Why the last discovery was incomplete (null when every lookup worked). */
    discoveryError: text("discovery_error"),
    /** Public places (demo areas and guest searches) are opened by slug, without an account. */
    slug: text("slug").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("locations_user_idx").on(t.userId)],
);

/**
 * Something we scrape: a restaurant website or a grocery store.
 * provider = "web" (restaurant site), "willys", "hemkop", "chain" (fast food chain,
 * externalId = chain id; one source for the whole chain), "outlet" (any other fast
 * food place or food court from OSM, externalId = OSM id, url may be null).
 */
export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    section: text("section").$type<Section>().notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    address: text("address"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    lastScrapedWeek: text("last_scraped_week"),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sources_provider_ext_idx").on(t.provider, t.externalId)],
);

export const locationSources = pgTable(
  "location_sources",
  {
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    distanceM: integer("distance_m").notNull(),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.sourceId] })],
);

export const offers = pgTable(
  "offers",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(),
    section: text("section").$type<Section>().notNull(),
    /** ISO weekday 1-7 for day-specific lunch dishes, null = valid all week. */
    day: integer("day"),
    title: text("title").notNull(),
    description: text("description"),
    priceText: text("price_text"),
    priceSek: doublePrecision("price_sek"),
    savingsSek: doublePrecision("savings_sek"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    imageUrl: text("image_url"),
    url: text("url"),
    validTo: text("valid_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offers_source_week_idx").on(t.sourceId, t.weekKey)],
);

export type DigestContent = {
  headline: string;
  summary: string;
  picks: { offerId: number; reason: string }[];
  generatedBy: "claude" | "rules";
};

/** Cached weekly summary per user, location and section. */
export const digests = pgTable(
  "digests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(),
    section: text("section").$type<Section>().notNull(),
    offerCount: integer("offer_count").notNull(),
    content: jsonb("content").$type<DigestContent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("digests_unique_idx").on(t.locationId, t.weekKey, t.section)],
);

/**
 * The last page fetched for a source that yielded no offers. Lets us see what a
 * site really returns (markup, embedded data) when writing a better parser.
 */
export const pageSnapshots = pgTable("page_snapshots", {
  sourceId: integer("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: integer("status").notNull(),
  html: text("html").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;

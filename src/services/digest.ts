import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { DigestContent, Location, Section } from "@/db/schema";
import { currentWeekKey, WEEKDAYS } from "@/lib/week";
import { isClaudeEnabled, summarizeWeek } from "@/lib/claude";
import { dedupeOffers, type OfferView } from "@/lib/offers";

export type { OfferView };

/** All offers for this week around one location, restricted to the days the user is there. */
export async function offersForLocation(location: Location, section: Section, weekKey = currentWeekKey()) {
  const db = await getDb();
  const rows = await db
    .select({
      offer: schema.offers,
      sourceName: schema.sources.name,
      sourceAddress: schema.sources.address,
      sourceUrl: schema.sources.url,
      distanceM: schema.locationSources.distanceM,
    })
    .from(schema.offers)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.offers.sourceId))
    .innerJoin(schema.locationSources, eq(schema.locationSources.sourceId, schema.sources.id))
    .where(
      and(
        eq(schema.locationSources.locationId, location.id),
        eq(schema.offers.weekKey, weekKey),
        eq(schema.offers.section, section),
      ),
    );
  return rows
    .filter((r) => r.offer.day == null || location.days.includes(r.offer.day))
    .map<OfferView>((r) => ({
      id: r.offer.id,
      section: r.offer.section,
      day: r.offer.day,
      title: r.offer.title,
      description: r.offer.description,
      priceText: r.offer.priceText,
      priceSek: r.offer.priceSek,
      savingsSek: r.offer.savingsSek,
      tags: r.offer.tags,
      imageUrl: r.offer.imageUrl,
      url: r.offer.url,
      validTo: r.offer.validTo,
      sourceId: r.offer.sourceId,
      sourceName: r.sourceName,
      sourceAddress: r.sourceAddress,
      sourceUrl: r.sourceUrl,
      distanceM: r.distanceM,
    }));
}

function rulesDigest(section: Section, location: Location, offers: OfferView[]): DigestContent {
  if (section === "grocery") {
    const unique = dedupeOffers(offers);
    const top = unique.sort((a, b) => (b.savingsSek ?? 0) - (a.savingsSek ?? 0)).slice(0, 6);
    const stores = new Set(offers.map((o) => o.sourceName)).size;
    return {
      headline: `${unique.length} grocery deals near ${location.label}`,
      summary: `${stores} store(s) within reach have ${unique.length} different deals this week. The biggest savings are listed first — up to ${Math.round(top[0]?.savingsSek ?? 0)} kr on a single item.`,
      picks: top.map((o) => ({
        offerId: o.id,
        reason: `Save ${o.savingsSek ?? "?"} kr${o.stores.length > 1 ? ` · ${o.stores.length} stores` : ""}`,
      })),
      generatedBy: "rules",
    };
  }
  const priced = offers.filter((o) => o.priceSek);
  const cheapest = [...priced].sort((a, b) => a.priceSek! - b.priceSek!).slice(0, 3);
  const nearest = [...offers].sort((a, b) => a.distanceM - b.distanceM).slice(0, 2);
  const picks = [...new Map([...cheapest, ...nearest].map((o) => [o.id, o])).values()];
  const places = new Set(offers.map((o) => o.sourceName)).size;
  return {
    headline: `${places} lunch spots near ${location.label}`,
    summary: `${offers.length} lunch dishes from ${places} restaurant(s) this week${priced.length ? `, from ${Math.min(...priced.map((o) => o.priceSek!))} kr` : ""}. Add an Anthropic API key for an AI-written summary.`,
    picks: picks.map((o) => ({
      offerId: o.id,
      reason: o.priceSek && cheapest.includes(o) ? `Good value at ${o.priceSek} kr` : `Only ${o.distanceM} m away`,
    })),
    generatedBy: "rules",
  };
}

/** Get (or build and cache) the digest for one location + section this week. */
export async function getDigest(location: Location, section: Section, offers: OfferView[], force = false) {
  const db = await getDb();
  const weekKey = currentWeekKey();
  const [existing] = await db
    .select()
    .from(schema.digests)
    .where(
      and(
        eq(schema.digests.locationId, location.id),
        eq(schema.digests.weekKey, weekKey),
        eq(schema.digests.section, section),
      ),
    );
  if (existing && existing.offerCount === offers.length && !force) return existing.content;
  if (!offers.length) return null;

  let content: DigestContent = rulesDigest(section, location, offers);
  if (isClaudeEnabled()) {
    const input = (section === "grocery"
      ? dedupeOffers(offers).sort((a, b) => (b.savingsSek ?? 0) - (a.savingsSek ?? 0))
      : [...offers].sort((a, b) => a.distanceM - b.distanceM)
    )
      .slice(0, 200)
      .map((o) => ({
        id: o.id,
        source: o.sourceName,
        distanceM: o.distanceM,
        day: o.day ? WEEKDAYS[o.day - 1].short : null,
        title: o.title,
        description: o.description,
        priceSek: o.priceSek,
        savingsSek: o.savingsSek,
        tags: o.tags,
      }));
    try {
      const ai = await summarizeWeek({
        section,
        locationLabel: `${location.label} (${location.address})`,
        days: location.days.map((d) => WEEKDAYS[d - 1].short),
        offers: input,
      });
      if (ai) content = { ...ai, generatedBy: "claude" };
    } catch (e) {
      console.error("Claude digest failed, using rules", e);
    }
  }

  await db
    .insert(schema.digests)
    .values({ userId: location.userId, locationId: location.id, weekKey, section, offerCount: offers.length, content })
    .onConflictDoUpdate({
      target: [schema.digests.locationId, schema.digests.weekKey, schema.digests.section],
      set: { content, offerCount: offers.length, createdAt: new Date() },
    });
  return content;
}

/** Precompute digests for many locations (used by the cron job). */
export async function buildDigests(locationIds?: number[], budgetMs = 60_000, force = false) {
  const db = await getDb();
  const started = Date.now();
  const locs = await db
    .select()
    .from(schema.locations)
    .where(locationIds?.length ? inArray(schema.locations.id, locationIds) : undefined);
  let built = 0;
  for (const loc of locs) {
    if (Date.now() - started > budgetMs) break;
    for (const section of ["lunch", "grocery"] as const) {
      await getDigest(loc, section, await offersForLocation(loc, section), force);
      built++;
    }
  }
  return { built };
}

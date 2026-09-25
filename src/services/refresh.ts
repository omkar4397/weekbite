import "server-only";
import { and, eq, inArray, isNull, lt, ne, or, sql, like, asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NewOffer, Source } from "@/db/schema";
import { currentWeekKey } from "@/lib/week";
import { scrapeLunch } from "@/scrapers/restaurant";
import { fetchStoreOffers, type AxfoodChain } from "@/scrapers/axfood";
import { CHAINS, scrapeChainDeals } from "@/scrapers/fastfood";

async function scrapeSource(source: Source, weekKey: string): Promise<{ offers: NewOffer[]; status: string }> {
  if (source.section === "grocery") {
    const items = await fetchStoreOffers(source.provider as AxfoodChain, source.externalId);
    return {
      status: `ok (${items.length})`,
      offers: items.map((o) => ({ ...o, sourceId: source.id, weekKey, section: "grocery", day: null, url: source.url })),
    };
  }
  if (source.section === "fastfood") {
    const chain = CHAINS.find((c) => c.id === source.externalId);
    if (!chain) return { offers: [], status: "unknown chain" };
    const { offers, status } = await scrapeChainDeals(chain, weekKey);
    return { status, offers: offers.map((o) => ({ ...o, sourceId: source.id, weekKey, section: "fastfood", day: null })) };
  }
  const { offers, status } = await scrapeLunch({ name: source.name, website: source.url! }, weekKey);
  return {
    status,
    offers: offers.map((o) => ({ ...o, sourceId: source.id, weekKey, section: "lunch" })),
  };
}

/**
 * Scrape sources that don't have this week's data yet. Restaurants and chains
 * that had nothing are retried once a day, because many publish on Monday morning.
 * Stops early when the time budget runs out (Vercel function limits).
 */
export async function refreshSources(opts: { sourceIds?: number[]; limit?: number; budgetMs?: number } = {}) {
  const db = await getDb();
  const weekKey = currentWeekKey();
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const dayAgo = new Date(Date.now() - 20 * 3600_000);

  const stale = or(
    isNull(schema.sources.lastScrapedWeek),
    ne(schema.sources.lastScrapedWeek, weekKey),
    and(like(schema.sources.lastStatus, "no menu%"), lt(schema.sources.lastScrapedAt, dayAgo)),
    and(like(schema.sources.lastStatus, "no deals%"), lt(schema.sources.lastScrapedAt, dayAgo)),
    and(like(schema.sources.lastStatus, "error%"), lt(schema.sources.lastScrapedAt, dayAgo)),
  );
  const linked = sql`exists (select 1 from ${schema.locationSources} ls where ls.source_id = ${schema.sources.id})`;

  const todo = await db
    .select()
    .from(schema.sources)
    .where(and(stale, linked, opts.sourceIds?.length ? inArray(schema.sources.id, opts.sourceIds) : undefined))
    .orderBy(asc(schema.sources.section), sql`${schema.sources.lastScrapedAt} asc nulls first`)
    .limit(opts.limit ?? 60);

  const results = { scraped: 0, offers: 0, errors: 0, skipped: 0 };
  const queue = [...todo];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        results.skipped++;
        continue;
      }
      let status: string;
      try {
        const { offers, status: st } = await scrapeSource(s, weekKey);
        status = st;
        await db.delete(schema.offers).where(and(eq(schema.offers.sourceId, s.id), eq(schema.offers.weekKey, weekKey)));
        for (let i = 0; i < offers.length; i += 200) {
          await db.insert(schema.offers).values(offers.slice(i, i + 200));
        }
        results.offers += offers.length;
      } catch (e) {
        status = `error: ${(e as Error).message}`.slice(0, 200);
        results.errors++;
      }
      await db
        .update(schema.sources)
        .set({ lastScrapedWeek: weekKey, lastScrapedAt: new Date(), lastStatus: status })
        .where(eq(schema.sources.id, s.id));
      results.scraped++;
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return { weekKey, ...results, remaining: results.skipped };
}

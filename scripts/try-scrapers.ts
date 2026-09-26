/**
 * Smoke-test the scrapers against live sites without a database:
 *   npm run try-scrapers -- "Kungsgatan 10, Stockholm"
 *   npm run try-scrapers -- --chains      (fast food chain deals only, no address needed)
 */
import { geocode } from "../src/lib/geo";
import { storesNear, fetchStoreOffers } from "../src/scrapers/axfood";
import { fastFoodNear, restaurantsNear } from "../src/scrapers/osm";
import { CHAINS, chainFor, scrapeDeals } from "../src/scrapers/fastfood";
import { scrapeLunch } from "../src/scrapers/restaurant";
import { currentWeekKey } from "../src/lib/week";

async function tryChains() {
  console.log(`🍔 Fast food chain deals (week ${currentWeekKey()}):`);
  for (const chain of CHAINS) {
    try {
      const res = await scrapeDeals(chain, currentWeekKey());
      console.log(`   ${chain.name} -> ${res.status}`);
      for (const o of res.offers.slice(0, 5)) console.log(`      · ${o.title} ${o.priceText ?? ""}${o.tags.length ? ` [${o.tags.join(", ")}]` : ""}`);
    } catch (e) {
      console.log(`   ${chain.name} -> error: ${(e as Error).message}`);
    }
  }
}

async function main() {
  if (process.argv[2] === "--chains") return tryChains();
  const address = process.argv[2] ?? "Drottninggatan 50, Stockholm";
  const point = await geocode(address);
  if (!point) throw new Error("Address not found");
  console.log(`📍 ${point.displayName} (${point.lat}, ${point.lng}) week ${currentWeekKey()}\n`);

  const stores = await storesNear(point, 2000);
  console.log(`🛒 ${stores.length} Axfood stores within 2 km:`, stores.slice(0, 5).map((s) => `${s.name} (${s.distanceM} m)`));
  if (stores[0]) {
    const offers = await fetchStoreOffers(stores[0].chain, stores[0].storeId);
    const top = offers.sort((a, b) => (b.savingsSek ?? 0) - (a.savingsSek ?? 0)).slice(0, 5);
    console.log(`   ${offers.length} offers at ${stores[0].name}; top savings:`);
    for (const o of top) console.log(`   - ${o.title}: ${o.priceText} (save ${o.savingsSek} kr)`);
  }

  const restaurants = await restaurantsNear(point, 800, 12);
  console.log(`\n🍽️ ${restaurants.length} restaurants with websites within 800 m`);
  for (const r of restaurants) {
    try {
      const res = await scrapeLunch({ name: r.name, website: r.website }, currentWeekKey());
      console.log(`   ${r.name} (${r.distanceM} m) ${r.website} -> ${res.status}`);
      for (const o of res.offers.slice(0, 3)) console.log(`      · [day ${o.day ?? "all"}] ${o.title} ${o.priceSek ?? ""}`);
    } catch (e) {
      console.log(`   ${r.name} -> error: ${(e as Error).message}`);
    }
  }

  const branches = (await fastFoodNear(point, 2000)).filter((p) => chainFor({ brand: p.brand ?? undefined, name: p.name }));
  console.log(`\n🍔 ${branches.length} chain branches within 2 km:`, branches.slice(0, 8).map((b) => `${b.name} (${b.distanceM} m)`));
  await tryChains();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

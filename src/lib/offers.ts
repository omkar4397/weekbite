import type { Section } from "@/db/schema";

/** An offer joined with where it's from; shared by server code and client components. */
export type OfferView = {
  id: number;
  section: Section;
  day: number | null;
  title: string;
  description: string | null;
  priceText: string | null;
  priceSek: number | null;
  savingsSek: number | null;
  tags: string[];
  imageUrl: string | null;
  url: string | null;
  validTo: string | null;
  sourceId: number;
  sourceName: string;
  sourceAddress: string | null;
  sourceUrl: string | null;
  distanceM: number;
};

/** Chains run the same campaign in every store: keep one offer per product + price (nearest store first). */
export function dedupeOffers(offers: OfferView[]) {
  const map = new Map<string, OfferView & { stores: { id: number; name: string }[] }>();
  for (const o of [...offers].sort((a, b) => a.distanceM - b.distanceM)) {
    const key = `${o.title}|${o.priceText ?? o.priceSek}`;
    const hit = map.get(key);
    if (hit) hit.stores.push({ id: o.sourceId, name: o.sourceName });
    else map.set(key, { ...o, stores: [{ id: o.sourceId, name: o.sourceName }] });
  }
  return [...map.values()];
}

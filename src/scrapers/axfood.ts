/**
 * Willys and Hemköp (both Axfood) expose public JSON endpoints used by their own
 * websites: a store list and per-store weekly in-store campaigns.
 */
import { fetchJson } from "@/lib/http";
import { distanceM } from "@/lib/geo";

export const AXFOOD_CHAINS = {
  willys: { name: "Willys", base: "https://www.willys.se" },
  hemkop: { name: "Hemköp", base: "https://www.hemkop.se" },
} as const;
export type AxfoodChain = keyof typeof AXFOOD_CHAINS;

type RawStore = {
  storeId: string;
  name: string;
  address?: string | { formattedAddress?: string; line1?: string; town?: string } | null;
  geoPoint?: { latitude: number; longitude: number } | null;
  onlineStore?: boolean;
};

export type GroceryStore = {
  chain: AxfoodChain;
  storeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  url: string;
};

const storeCache = new Map<AxfoodChain, { at: number; stores: GroceryStore[] }>();

function formatAddress(a: RawStore["address"]) {
  if (!a) return null;
  if (typeof a === "string") return a;
  return a.formattedAddress ?? [a.line1, a.town].filter(Boolean).join(", ") ?? null;
}

export async function listStores(chain: AxfoodChain): Promise<GroceryStore[]> {
  const cached = storeCache.get(chain);
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.stores;
  const { base, name } = AXFOOD_CHAINS[chain];
  const raw = await fetchJson<RawStore[]>(`${base}/axfood/rest/store?online=false`);
  const stores = raw
    .filter((s) => s.geoPoint && s.geoPoint.latitude !== 0 && s.name && !s.onlineStore)
    .map((s) => ({
      chain,
      storeId: s.storeId,
      name: s.name.toLowerCase().includes(name.toLowerCase()) ? s.name : `${name} ${s.name}`,
      address: formatAddress(s.address),
      lat: s.geoPoint!.latitude,
      lng: s.geoPoint!.longitude,
      url: `${base}/erbjudanden/butik?storeId=${s.storeId}`,
    }));
  storeCache.set(chain, { at: Date.now(), stores });
  return stores;
}

export async function storesNear(point: { lat: number; lng: number }, radiusM: number) {
  const all = (await Promise.all((Object.keys(AXFOOD_CHAINS) as AxfoodChain[]).map(listStores))).flat();
  return all
    .map((s) => ({ ...s, distanceM: distanceM(point, s) }))
    .filter((s) => s.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

type RawPromotion = {
  cartLabel?: string | null;
  conditionLabel?: string | null;
  rewardLabel?: string | null;
  price?: number | null;
  savePrice?: string | null;
  comparePrice?: string | null;
  endDate?: string | null;
  campaignType?: string | null;
  redeemLimitLabel?: string | null;
  description?: string | null;
};

type RawProduct = {
  name: string;
  manufacturer?: string | null;
  displayVolume?: string | null;
  priceValue?: number | null;
  price?: string | null;
  image?: { url?: string } | null;
  thumbnail?: { url?: string } | null;
  potentialPromotions?: RawPromotion[];
};

export type GroceryOffer = {
  title: string;
  description: string | null;
  priceText: string | null;
  priceSek: number | null;
  savingsSek: number | null;
  tags: string[];
  imageUrl: string | null;
  validTo: string | null;
};

function parseSek(s: string | null | undefined) {
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

export async function fetchStoreOffers(chain: AxfoodChain, storeId: string): Promise<GroceryOffer[]> {
  const { base } = AXFOOD_CHAINS[chain];
  const out: GroceryOffer[] = [];
  for (let page = 0; page < 10; page++) {
    const data = await fetchJson<{
      results: RawProduct[] | null;
      pagination: { numberOfPages: number };
    }>(`${base}/search/campaigns/offline?q=${storeId}&type=PERSONAL_GENERAL&page=${page}&size=200`);
    for (const p of data.results ?? []) {
      const promo = p.potentialPromotions?.[0];
      if (!promo) continue;
      const tags: string[] = [];
      if (promo.campaignType === "LOYALTY") tags.push("Member price");
      if (promo.redeemLimitLabel) tags.push(promo.redeemLimitLabel);
      out.push({
        title: [p.name, p.displayVolume].filter(Boolean).join(" "),
        description: [p.manufacturer, promo.description, promo.comparePrice && `Jfr ${promo.comparePrice}`]
          .filter(Boolean)
          .join(" · ") || null,
        priceText: promo.cartLabel || [promo.conditionLabel, promo.rewardLabel].filter(Boolean).join(" ") || null,
        priceSek: promo.price ?? null,
        savingsSek: parseSek(promo.savePrice),
        tags,
        imageUrl: p.image?.url ?? p.thumbnail?.url ?? null,
        validTo: promo.endDate ?? null,
      });
    }
    if (page + 1 >= (data.pagination?.numberOfPages ?? 0)) break;
  }
  return out;
}

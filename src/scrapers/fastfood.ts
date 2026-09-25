/**
 * Fast food chains: nationwide deals from each chain's own website.
 * A chain's deals are the same in every branch, so each chain is one source,
 * scraped once a week. Branch locations (from OpenStreetMap) only decide
 * which chains are "near" a user's location.
 */
import * as cheerio from "cheerio";
import { fetchText, isAllowedByRobots } from "@/lib/http";
import { extractFastFoodDeals, isClaudeEnabled } from "@/lib/claude";
import { pageText } from "@/scrapers/restaurant";

export type Chain = {
  id: string;
  name: string;
  /** Matched against OSM brand/name tags of fast food places. */
  match: RegExp;
  homepage: string;
  /** Known deal pages, tried before links discovered on the homepage. */
  dealPages: string[];
};

export const CHAINS: Chain[] = [
  {
    id: "mcdonalds",
    name: "McDonald's",
    match: /^mc ?donald'?s/i,
    homepage: "https://www.mcdonalds.com/se/sv-se.html",
    dealPages: ["https://www.mcdonalds.com/se/sv-se/var-meny/winnin-deals.html"],
  },
  { id: "burgerking", name: "Burger King", match: /^burger king/i, homepage: "https://www.burgerking.se/", dealPages: [] },
  { id: "max", name: "MAX", match: /^max( burgers| hamburgerrestauranger)?$/i, homepage: "https://www.max.se/", dealPages: [] },
  { id: "subway", name: "Subway", match: /^subway/i, homepage: "https://www.subway.com/sv-SE", dealPages: [] },
  { id: "sibylla", name: "Sibylla", match: /^sibylla/i, homepage: "https://www.sibylla.se/", dealPages: [] },
  { id: "kfc", name: "KFC", match: /^(kfc|kentucky fried chicken)/i, homepage: "https://www.kfc.se/", dealPages: [] },
  { id: "pizzahut", name: "Pizza Hut", match: /^pizza hut/i, homepage: "https://www.pizzahut.se/", dealPages: [] },
  { id: "tacobar", name: "Taco Bar", match: /^taco ?bar/i, homepage: "https://www.tacobar.se/", dealPages: [] },
];

/** Which chain (if any) an OSM place belongs to, from its brand or name tag. */
export function chainFor(tags: { brand?: string; name?: string }) {
  return CHAINS.find((c) => (tags.brand && c.match.test(tags.brand.trim())) || (tags.name && c.match.test(tags.name.trim())));
}

export type FastFoodDeal = {
  title: string;
  description: string | null;
  priceText: string | null;
  priceSek: number | null;
  savingsSek: number | null;
  tags: string[];
  imageUrl: string | null;
  url: string;
  validTo: string | null;
};

const DEAL_WORDS = /erbjudand|kampanj|deals?\b|winnin|offers?\b|aktuellt|just nu|app[- ]?erbjud|rabatt/i;
const PRICE_RE = /(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:kr\b|:-|sek\b)/i;
/** A price with its qualifier, e.g. "2 för 30 kr", "fr. 99 kr", "Nu 19:-". */
const PRICE_PHRASE_RE = /(?:(?:\d+\s*(?:st\s*)?för|fr\.|från|nu|endast|just nu)\s*)?\d{1,3}(?:[,.]\d{1,2})?\s*(?:kr\b|:-|sek\b)/gi;
const ORDINARY_RE = /\bord(?:\.|inarie)|\btidigare\b|\bspara\b/i;
const APP_RE = /\bi appen\b|\bappen\b|app-?erbjudande|\bapp only\b|mymax|bk-?appen/i;

function dealLinks(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const scored = new Map<string, number>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href")!;
    const label = `${$(a).text()} ${href}`;
    if (!DEAL_WORDS.test(label)) return;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || url.host !== base.host) return;
    url.hash = "";
    let score = 1;
    if (/erbjudand|deals?\b|winnin|offers?\b/i.test(label)) score += 2;
    if (/kampanj|just nu/i.test(label)) score += 1;
    scored.set(url.toString(), Math.max(scored.get(url.toString()) ?? 0, score));
  });
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 3);
}

function parsePrice(text: string) {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return n >= 5 && n <= 1000 ? { text: m[0], sek: n } : null;
}

/** All prices in a card; the lowest is the deal price, a higher "ord. pris" the ordinary one. */
function cardPrices(text: string) {
  const phrases = [...text.matchAll(PRICE_PHRASE_RE)]
    .map((m) => ({ text: m[0].trim(), sek: parsePrice(m[0])?.sek }))
    .filter((p): p is { text: string; sek: number } => p.sek != null);
  if (!phrases.length) return null;
  const deal = phrases.reduce((a, b) => (b.sek < a.sek ? b : a));
  const ordinary = ORDINARY_RE.test(text) ? Math.max(...phrases.map((p) => p.sek)) : null;
  return { deal, savings: ordinary != null && ordinary > deal.sek ? Math.round((ordinary - deal.sek) * 100) / 100 : null };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Rule-based fallback: find "cards" on the page — the smallest elements that
 * contain a price — and take the heading and image in the same card.
 * Works without knowing each chain's markup.
 */
export function heuristicDeals(html: string, url: string): FastFoodDeal[] {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,header,nav,footer,form").remove();
  // Keep words in neighbouring elements apart ("39 kr" + "Nu 19:-", not "39 krNu 19:-").
  $("body *").each((_, el) => {
    $(el).append(" ");
  });
  const deals = new Map<string, FastFoodDeal>();

  $("body *").each((_, el) => {
    const $el = $(el);
    const text = clean($el.text());
    if (text.length > 400 || !parsePrice(text)) return;
    // Only the deepest element with a price; its ancestors are handled below.
    if ($el.children().toArray().some((c) => parsePrice(clean($(c).text())))) return;

    // Walk up to the card that also holds a title or image.
    let card = $el;
    for (let i = 0; i < 4; i++) {
      if (card.find("h1,h2,h3,h4,h5,strong,[class*=title],[class*=name],img").length) break;
      const parent = card.parent();
      if (!parent.length || clean(parent.text()).length > 500) break;
      card = parent;
    }
    const cardText = clean(card.text());
    const heading = clean(card.find("h1,h2,h3,h4,h5,[class*=title],[class*=name],strong").first().text());
    const prices = cardPrices(cardText);
    if (!prices) return;
    const title = (heading && !PRICE_RE.test(heading) ? heading : cardText.split(PRICE_PHRASE_RE)[0]).slice(0, 120).trim();
    if (title.length < 3 || /^(pris|från|fr\.|totalt|summa)$/i.test(title)) return;

    const description =
      clean(
        cardText
          .replace(title, "")
          .replace(PRICE_PHRASE_RE, "")
          .replace(/\bord(?:\.|inarie)?\s*pris:?/gi, ""),
      ).slice(0, 240) || null;
    const src = card.find("img").first().attr("src") ?? card.find("img").first().attr("data-src");
    let imageUrl: string | null = null;
    try {
      imageUrl = src ? new URL(src, url).toString() : null;
    } catch {
      imageUrl = null;
    }
    const key = title.toLowerCase();
    if (deals.has(key)) return;
    deals.set(key, {
      title,
      description,
      priceText: prices.deal.text,
      priceSek: prices.deal.sek,
      savingsSek: prices.savings,
      tags: APP_RE.test(cardText) ? ["app deal"] : [],
      imageUrl,
      url,
      validTo: cardText.match(/(?:t\.?o\.?m\.?|till och med|gäller till)\s*([\d]{1,2}\/[\d]{1,2}|\d{1,2} \p{L}+)/iu)?.[1] ?? null,
    });
  });
  return [...deals.values()].slice(0, 30);
}

/** Scrape one chain's current deals. */
export async function scrapeChainDeals(chain: Chain, weekKey: string) {
  const pages = [...chain.dealPages];
  if (await isAllowedByRobots(chain.homepage)) {
    try {
      const home = await fetchText(chain.homepage);
      for (const link of dealLinks(home.text, home.finalUrl)) if (!pages.includes(link)) pages.push(link);
    } catch {
      // homepage down: rely on the known deal pages
    }
  }
  if (!pages.length) return { offers: [] as FastFoodDeal[], status: "no deals page found" };

  let lastError: Error | null = null;
  for (const pageUrl of pages.slice(0, 3)) {
    if (!(await isAllowedByRobots(pageUrl))) continue;
    let page: Awaited<ReturnType<typeof fetchText>>;
    try {
      page = await fetchText(pageUrl);
    } catch (e) {
      lastError = e as Error;
      continue;
    }
    let offers: FastFoodDeal[];
    let via: string;
    if (isClaudeEnabled()) {
      const out = await extractFastFoodDeals({ chainName: chain.name, url: page.finalUrl, weekKey, text: pageText(page.text) });
      offers = (out?.deals ?? []).map((d) => ({
        title: d.title,
        description: d.description,
        priceText: d.price_sek != null ? `${d.price_sek} kr` : null,
        priceSek: d.price_sek,
        savingsSek: d.ordinary_price_sek != null && d.price_sek != null && d.ordinary_price_sek > d.price_sek
          ? d.ordinary_price_sek - d.price_sek
          : null,
        tags: [...(d.app_only ? ["app deal"] : []), ...d.tags],
        imageUrl: null,
        url: page.finalUrl,
        validTo: d.valid_to,
      }));
      via = "claude";
    } else {
      offers = heuristicDeals(page.text, page.finalUrl);
      via = "rules";
    }
    if (offers.length) return { offers, status: `ok (${via}, ${offers.length})` };
  }
  if (lastError) throw lastError;
  return { offers: [] as FastFoodDeal[], status: "no deals found" };
}

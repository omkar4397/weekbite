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
    if (url.pathname === base.pathname || url.pathname === "/") return; // back to the homepage itself
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

// ---------------------------------------------------------------------------
// Deals embedded as JSON (Next.js __NEXT_DATA__, JSON-LD, application/json)
// ---------------------------------------------------------------------------

const TITLE_KEYS = ["title", "name", "productName", "headline", "displayName", "heading"];
const PRICE_KEYS = ["price", "priceValue", "salesPrice", "offerPrice", "currentPrice", "campaignPrice", "amount"];
const ORDINARY_KEYS = ["originalPrice", "ordinaryPrice", "regularPrice", "oldPrice", "listPrice", "beforePrice"];
const DESC_KEYS = ["description", "subtitle", "subTitle", "text", "body", "teaser"];
const IMAGE_KEYS = ["image", "imageUrl", "img", "src", "thumbnail", "picture"];

function asPrice(v: unknown): number | null {
  if (typeof v === "number") return v >= 5 && v <= 1000 ? v : v >= 500 && v <= 100_000 && Number.isInteger(v) ? v / 100 : null; // öre
  if (typeof v === "string") return parsePrice(v)?.sek ?? (/^\d{1,3}([.,]\d{1,2})?$/.test(v.trim()) ? Number(v.replace(",", ".")) : null);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asPrice(o.value ?? o.amount ?? o.price ?? o.formatted ?? o.formattedValue);
  }
  return null;
}

const first = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => v != null && v !== "");
const plain = (v: unknown) => (typeof v === "string" ? clean(cheerio.load(v).text()) : null);

function imageOf(v: unknown, base: string): string | null {
  const raw = typeof v === "string" ? v : v && typeof v === "object" ? (first(v as Record<string, unknown>, ["url", "src", "href"]) as string) : null;
  if (typeof raw !== "string" || !/\.(png|jpe?g|webp|avif|gif)|\/image/i.test(raw)) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/** Objects in the page's embedded JSON that look like a product/deal with a price. */
export function embeddedJsonDeals(html: string, url: string): FastFoodDeal[] {
  const $ = cheerio.load(html);
  const blobs: unknown[] = [];
  $('script[type="application/ld+json"], script[type="application/json"], script#__NEXT_DATA__').each((_, el) => {
    try {
      blobs.push(JSON.parse($(el).text()));
    } catch {
      // not JSON
    }
  });
  const deals = new Map<string, FastFoodDeal>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 40 || seen.has(v) || deals.size >= 60) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    const title = plain(first(o, TITLE_KEYS));
    // JSON-LD puts the price in offers: { price }.
    const offer = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
    const price = asPrice(first(o, PRICE_KEYS) ?? offer?.price);
    if (title && title.length >= 3 && title.length <= 120 && price != null) {
      const ordinary = asPrice(first(o, ORDINARY_KEYS));
      const description = plain(first(o, DESC_KEYS));
      const key = title.toLowerCase();
      if (!deals.has(key)) {
        deals.set(key, {
          title,
          description: description && description !== title ? description.slice(0, 240) : null,
          priceText: `${price} kr`,
          priceSek: price,
          savingsSek: ordinary != null && ordinary > price ? Math.round((ordinary - price) * 100) / 100 : null,
          tags: APP_RE.test(JSON.stringify(o).slice(0, 2000)) ? ["app deal"] : [],
          imageUrl: imageOf(first(o, IMAGE_KEYS), url),
          url,
          validTo: typeof o.validTo === "string" ? o.validTo : typeof offer?.priceValidUntil === "string" ? offer.priceValidUntil : null,
        });
      }
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  blobs.forEach((b) => walk(b, 0));
  return [...deals.values()].slice(0, 30);
}

/** Short description of a page, recorded when no deals were found (helps write better parsers). */
function pageStats(html: string) {
  const $ = cheerio.load(html);
  const prices = (pageText(html).match(new RegExp(PRICE_RE, "gi")) ?? []).length;
  const markers = [
    $("script#__NEXT_DATA__").length && "next-data",
    $('script[type="application/ld+json"]').length && "json-ld",
    /window\.__(NUXT|INITIAL_STATE|APOLLO_STATE)__/.test(html) && "js-state",
    $("body").text().trim().length < 500 && "js-rendered",
  ].filter(Boolean);
  return `${Math.round(html.length / 1024)} kB, ${prices} prices${markers.length ? `, ${markers.join(", ")}` : ""}`;
}

export type DealTarget = { name: string; homepage: string | null; dealPages: string[] };
export type PageSnapshot = { url: string; status: number; html: string };

/**
 * Scrape a chain's or outlet's current deals from known deal pages and deal links
 * found on the homepage (never the homepage itself). Extraction: Claude when
 * enabled, otherwise price cards in the HTML, then embedded JSON.
 * When nothing is found, the pages seen are returned as snapshots.
 */
export async function scrapeDeals(target: DealTarget, weekKey: string) {
  const snapshots: PageSnapshot[] = [];
  if (!target.homepage && !target.dealPages.length) return { offers: [] as FastFoodDeal[], status: "no website", snapshots };

  const pages = [...target.dealPages];
  let home: Awaited<ReturnType<typeof fetchText>> | null = null;
  if (target.homepage && (await isAllowedByRobots(target.homepage))) {
    try {
      home = await fetchText(target.homepage);
      for (const link of dealLinks(home.text, home.finalUrl)) if (!pages.includes(link)) pages.push(link);
    } catch {
      // homepage down: rely on the known deal pages
    }
  }

  // Only deal/campaign pages count: a homepage or menu lists regular dishes, not deals.
  if (!pages.length) {
    if (home) snapshots.push({ url: home.finalUrl, status: 200, html: home.text });
    return {
      offers: [] as FastFoodDeal[],
      status: home ? `no deals page found (/: ${pageStats(home.text)})` : "no deals page found",
      snapshots,
    };
  }
  const stats: string[] = [];
  let lastError: Error | null = null;
  for (const pageUrl of [...new Set(pages.slice(0, 3))]) {
    if (!(await isAllowedByRobots(pageUrl))) continue;
    let page: Awaited<ReturnType<typeof fetchText>>;
    try {
      page = await fetchText(pageUrl);
    } catch (e) {
      lastError = e as Error;
      stats.push(`${new URL(pageUrl).pathname}: ${lastError.message.replace(/ for https?:\S+/, "")}`);
      continue;
    }
    let offers: FastFoodDeal[] = [];
    let via = "rules";
    if (isClaudeEnabled()) {
      const out = await extractFastFoodDeals({ chainName: target.name, url: page.finalUrl, weekKey, text: pageText(page.text) });
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
    }
    if (!offers.length) {
      offers = heuristicDeals(page.text, page.finalUrl);
      via = "rules";
    }
    if (!offers.length) {
      offers = embeddedJsonDeals(page.text, page.finalUrl);
      via = "json";
    }
    if (offers.length) return { offers, status: `ok (${via}, ${offers.length})`, snapshots };
    stats.push(`${new URL(page.finalUrl).pathname}: ${pageStats(page.text)}`);
    snapshots.push({ url: page.finalUrl, status: 200, html: page.text });
  }
  if (lastError && !snapshots.length) throw lastError;
  return { offers: [] as FastFoodDeal[], status: `no deals found (${stats.join("; ")})`.slice(0, 500), snapshots };
}

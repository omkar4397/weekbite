/**
 * Shopping centres and other venues with a restaurant directory page. The
 * directory tells us which restaurants are there (the food court), which
 * OpenStreetMap often knows only partly. Listed on the fast food tab.
 */
import * as cheerio from "cheerio";
import { fetchText, isAllowedByRobots } from "@/lib/http";
import type { PageSnapshot } from "@/scrapers/fastfood";

export type Venue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Page listing the venue's restaurants. */
  restaurantsUrl: string;
};

export const VENUES: Venue[] = [
  {
    id: "kistagalleria",
    name: "Kista Galleria",
    lat: 59.4033,
    lng: 17.9447,
    restaurantsUrl: "https://www.kistagalleria.se/en/restaurants/",
  },
];

/** Venues are shown for locations within this distance. */
export const VENUE_RADIUS_M = 3000;

export type VenueRestaurant = { name: string; url: string; description: string | null };

/** Marks venue restaurant rows in the offers table (they're listings, not deals). */
export const VENUE_TAG = "venue listing";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const GENERIC = /^(read more|läs mer|more|mer|visa|show|see all|se alla|all|alla|restaurants?|restauranger|mat & dryck|food & drink|open|öppet)$/i;

function titleFromSlug(slug: string) {
  const s = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Restaurants on a directory page: links to sub-pages of the directory
 * (/en/restaurants/<slug>/). Works across typical shopping centre sites
 * without knowing their markup.
 */
export function parseDirectory(html: string, pageUrl: string): VenueRestaurant[] {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,header,footer,nav").remove();

  // Store cards (e.g. Citycon centres such as Kista Galleria): <div class="store-card"
  // data-website-cat="restaurants"><a href="/en/store/ikki-3/"><h4>Ikki</h4><p>Cafes and Restaurants · Ground Floor</p>
  const cards = $('[data-website-cat="restaurants"], .store-card').toArray();
  const fromCards = new Map<string, VenueRestaurant>();
  for (const el of cards) {
    const $c = $(el);
    const cat = $c.attr("data-website-cat");
    if (cat && cat !== "restaurants") continue;
    const href = $c.find("a[href]").first().attr("href");
    const name = clean($c.find("h1,h2,h3,h4,h5,[class*=title],[class*=name]").first().text());
    if (!href || name.length < 2 || name.length > 60) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const details = clean($c.find("p").first().text()).replace(/\s*·\s*/g, " · ");
    fromCards.set(url, { name, url, description: details && details !== name ? details.slice(0, 120) : null });
  }
  if (fromCards.size >= 3) return [...fromCards.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const base = new URL(pageUrl);
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const found = new Map<string, VenueRestaurant>();
  $("a[href]").each((_, a) => {
    let url: URL;
    try {
      url = new URL($(a).attr("href")!, pageUrl);
    } catch {
      return;
    }
    if (url.host !== base.host || !url.pathname.startsWith(prefix)) return;
    const slug = url.pathname.slice(prefix.length).replace(/\/$/, "");
    if (!slug || slug.includes("/")) return; // the directory itself, or deeper pages
    url.hash = "";
    url.search = "";
    const $a = $(a);
    const card = $a.closest("li,article,[class*=card],[class*=item],[class*=tile]");
    const heading = clean($a.find("h1,h2,h3,h4,h5,[class*=title],[class*=name]").first().text());
    const text = clean($a.text());
    const name = [heading, $a.attr("aria-label"), $a.attr("title"), $a.find("img").attr("alt"), text]
      .map((v) => clean(v ?? ""))
      .find((v) => v.length >= 2 && v.length <= 60 && !GENERIC.test(v)) ?? titleFromSlug(slug);
    const category = clean(
      (card.length ? card : $a).find("[class*=categor],[class*=tag],[class*=type],[class*=floor],[class*=level]").first().text(),
    );
    const key = url.toString();
    const prev = found.get(key);
    if (!prev || (prev.name === titleFromSlug(slug) && name !== prev.name)) {
      found.set(key, { name, url: key, description: category && category !== name ? category.slice(0, 120) : prev?.description ?? null });
    }
  });
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export async function scrapeVenue(venue: Venue) {
  const snapshots: PageSnapshot[] = [];
  if (!(await isAllowedByRobots(venue.restaurantsUrl))) {
    return { restaurants: [] as VenueRestaurant[], status: "error: Blocked by robots.txt", snapshots };
  }
  const page = await fetchText(venue.restaurantsUrl);
  // Always keep the page: it's the reference for improving this parser.
  snapshots.push({ url: page.finalUrl, status: 200, html: page.text });
  const restaurants = parseDirectory(page.text, page.finalUrl);
  return {
    restaurants,
    status: restaurants.length ? `ok (${restaurants.length} restaurants)` : `no restaurants found (${Math.round(page.text.length / 1024)} kB)`,
    snapshots,
  };
}

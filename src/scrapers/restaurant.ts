/**
 * Scrape a restaurant website for this week's lunch menu.
 * 1. Fetch the homepage, follow the most promising "lunch"/"meny" link.
 * 2. Turn the page (or a linked PDF menu) into text.
 * 3. Extract dishes with Claude, or with a Swedish-weekday heuristic when no API key is set.
 */
import * as cheerio from "cheerio";
import { fetchBytes, fetchText, isAllowedByRobots } from "@/lib/http";
import { extractLunchMenu, isClaudeEnabled, type LunchMenu } from "@/lib/claude";
import { currentWeekDates, weekNumber, WEEKDAYS } from "@/lib/week";

export type LunchOffer = {
  day: number | null;
  title: string;
  description: string | null;
  priceSek: number | null;
  tags: string[];
  url: string;
};

const LUNCH_WORDS = /lunch|dagens|veckans|meny|menu|matsedel/i;
const DAY_RE = new RegExp(`^(${WEEKDAYS.map((d) => d.sv).join("|")})\\b`, "i");

function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,header nav,footer,form").remove();
  $("br,p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article").each((_, el) => {
    $(el).append("\n");
  });
  return $("body")
    .text()
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 24_000);
}

function lunchLinks(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const scored: { url: string; score: number }[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href")!;
    const label = `${$(a).text()} ${href}`;
    if (!LUNCH_WORDS.test(label)) return;
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    let score = 1;
    if (/lunch/i.test(label)) score += 3;
    if (/dagens|veckans/i.test(label)) score += 2;
    if (url.pathname.toLowerCase().endsWith(".pdf")) score += 1;
    if (new URL(baseUrl).host !== url.host) score -= 1;
    scored.push({ url: url.toString(), score });
  });
  const unique = new Map<string, number>();
  for (const s of scored) unique.set(s.url, Math.max(unique.get(s.url) ?? 0, s.score));
  return [...unique.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 2);
}

function looksLikeLunchMenu(text: string) {
  const dayHits = WEEKDAYS.slice(0, 5).filter((d) => new RegExp(`\\b${d.sv}\\b`, "i").test(text)).length;
  return /lunch/i.test(text) && dayHits >= 3;
}

type Candidate = { url: string; text?: string; pdf?: Buffer };

async function findMenuPage(website: string): Promise<Candidate | null> {
  if (!(await isAllowedByRobots(website))) throw new Error("Blocked by robots.txt");
  const home = await fetchText(website);
  const homeText = pageText(home.text);
  if (looksLikeLunchMenu(homeText)) return { url: home.finalUrl, text: homeText };

  for (const link of lunchLinks(home.text, home.finalUrl)) {
    if (!(await isAllowedByRobots(link))) continue;
    try {
      if (new URL(link).pathname.toLowerCase().endsWith(".pdf")) {
        if (isClaudeEnabled()) return { url: link, pdf: await fetchBytes(link) };
        continue;
      }
      const page = await fetchText(link);
      if (page.contentType.includes("pdf")) continue;
      const text = pageText(page.text);
      if (/lunch/i.test(text)) return { url: page.finalUrl, text };
    } catch {
      // try the next candidate
    }
  }
  return /lunch/i.test(homeText) ? { url: home.finalUrl, text: homeText } : null;
}

const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function fromClaude(menu: LunchMenu, url: string): LunchOffer[] {
  if (!menu.has_menu_for_this_week) return [];
  return menu.dishes.map((d) => ({
    day: d.day === "all_week" ? null : DAY_CODES.indexOf(d.day) + 1,
    title: d.title,
    description: d.description,
    priceSek: d.price_sek ?? menu.default_price_sek,
    tags: d.tags,
    url,
  }));
}

/** Rule-based fallback: dishes listed under Swedish weekday headings. */
const TIME_RE = /\b\d{1,2}([.:]\d{2})?\s*[-–]\s*\d{1,2}([.:]\d{2})?\b|stängt|öppet|öppettider/i;
const NOISE_RE = /^(lunch|pris|serveras|välkommen|kontakt|boka|meny|vår meny|se |läs mer|beställ|följ oss)/i;

export function heuristicExtract(text: string, url: string, weekKey: string): LunchOffer[] {
  if (!looksLikeLunchMenu(text)) return [];
  const weekMatch = text.match(/vecka\s*(\d{1,2})/i);
  if (weekMatch && Number(weekMatch[1]) !== weekNumber(weekKey)) return [];
  // Only look at the part of the page after the first mention of lunch.
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /lunch/i.test(l));
  const region = lines.slice(Math.max(start, 0));
  const priceMatch = region.join("\n").match(/(\d{2,3})\s*(?:kr|:-|sek)/i);
  const defaultPrice = priceMatch ? Number(priceMatch[1]) : null;

  const offers: LunchOffer[] = [];
  let day: number | null = null;
  for (const line of region) {
    const m = line.match(DAY_RE);
    if (m) {
      day = WEEKDAYS.find((d) => d.sv === m[1].toLowerCase())!.n;
      const rest = line.slice(m[0].length).replace(/^[\s:–-]+/, "").replace(/^\d{1,2}\/\d{1,2}\s*/, "");
      if (TIME_RE.test(rest)) day = null; // an opening-hours row, not a menu heading
      else if (rest.length > 8) offers.push({ day, title: rest, description: null, priceSek: defaultPrice, tags: [], url });
      continue;
    }
    if (day == null || line.length < 8 || line.length > 200) continue;
    if (NOISE_RE.test(line) || TIME_RE.test(line)) continue;
    if (/^[\p{L}]+ \d+[a-z]?,?$/u.test(line) || /\b\d{3} ?\d{2}\b/.test(line)) continue; // street address / postcode
    // Continuation lines (ingredient lists, wrapped sentences) belong to the previous dish.
    const prev = offers.at(-1);
    const isContinuation =
      prev?.day === day &&
      (/^[a-zåäö]/.test(line) ||
        /,$/.test(prev.description ?? prev.title) ||
        (line.match(/ [–-] /g)?.length ?? 0) >= 2 ||
        // "BUTTER CHICKEN" followed by a normal-case sentence describing it
        (!prev.description && prev.title === prev.title.toUpperCase() && line !== line.toUpperCase()));
    if (prev && isContinuation) {
      prev.description = prev.description ? `${prev.description} ${line}` : line;
      continue;
    }
    const own = line.match(/(\d{2,3})\s*(?:kr|:-)/i);
    offers.push({
      day,
      title: line.replace(/\s*\d{2,3}\s*(kr|:-).*$/i, ""),
      description: null,
      priceSek: own ? Number(own[1]) : defaultPrice,
      tags: /vegetar|vegan/i.test(line) ? ["vegetarian"] : [],
      url,
    });
    if (offers.filter((o) => o.day === day).length >= 4) day = null; // stop runaway lists
  }
  return offers.slice(0, 40);
}

export async function scrapeLunch(restaurant: { name: string; website: string }, weekKey: string) {
  const page = await findMenuPage(restaurant.website);
  if (!page) return { offers: [] as LunchOffer[], status: "no lunch page found" };

  if (isClaudeEnabled()) {
    const menu = await extractLunchMenu({
      restaurantName: restaurant.name,
      url: page.url,
      weekKey,
      weekDates: currentWeekDates(),
      text: page.text,
      pdf: page.pdf,
    });
    const offers = menu ? fromClaude(menu, page.url) : [];
    return { offers, status: offers.length ? `ok (claude, ${offers.length})` : "no menu for this week" };
  }
  const offers = heuristicExtract(page.text ?? "", page.url, weekKey);
  return { offers, status: offers.length ? `ok (rules, ${offers.length})` : "no menu for this week" };
}

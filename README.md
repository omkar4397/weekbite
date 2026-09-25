# WeekBite 🍽️🛒

Weekly food offers around the places you actually spend your week.

Users sign up and add a few **locations** (office, home, gym…), each with the **weekdays** they're usually
there and a walking radius. Every day WeekBite collects offers near those places and shows a weekly digest
in two sections:

| Section | Source | How |
|---|---|---|
| **Lunch & restaurants** | Restaurant websites found via OpenStreetMap | Finds the lunch/menu page (HTML or PDF), extracts this week's dishes per weekday |
| **Grocery deals** | Willys & Hemköp (Axfood) | Public JSON endpoints: store list + weekly in-store campaigns |

On top of each section there is a short **summary with top picks**, written by Claude when an
`ANTHROPIC_API_KEY` is set, or rule-based otherwise.

## Architecture

```
Next.js 16 (App Router) on Vercel
├── src/app                 pages, server actions, /api/cron/refresh
├── src/scrapers
│   ├── axfood.ts           Willys/Hemköp stores + campaigns (structured JSON)
│   ├── osm.ts              restaurant discovery via Overpass API
│   └── restaurant.ts       lunch page finder + Claude/heuristic extraction
├── src/services
│   ├── discovery.ts        location → nearby sources (location_sources table)
│   ├── refresh.ts          scrape sources that lack this week's offers
│   └── digest.ts           per location/section weekly summary (cached)
├── src/lib/claude.ts       Claude structured outputs (menu extraction, summaries)
└── src/db                  Drizzle schema; Neon Postgres in prod, PGlite locally
```

**Scheduling:** `vercel.json` runs `/api/cron/refresh` daily at 04:00 UTC (Hobby plans allow one cron
run per day). Each run:
- re-discovers locations that failed or are more than a week old;
- scrapes sources that have no data for the current ISO week;
- re-tries restaurants that had no menu yet, because many publish on Monday morning;
- rebuilds the digests.

Adding a location or pressing **Refresh** scrapes in the background via `after()`.

**Politeness:** the scrapers identify themselves with a user agent, respect `robots.txt`, send one request
at a time per site, and scrape at most once a day per source.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000, uses an embedded PGlite DB in ./.pglite
```

Optional: copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` for AI extraction and summaries.

Try the scrapers without the app or database:

```bash
npm run try-scrapers -- "Drottninggatan 50, Stockholm"
```

## Deploy (GitHub + Vercel)

1. Push this folder to a GitHub repository.
2. On vercel.com, **Add New → Project** and import the repo (framework: Next.js).
3. In the project, open **Storage → Create → Neon (Postgres)** and connect it. This sets `DATABASE_URL`.
4. Under **Settings → Environment Variables**, add `SESSION_SECRET`, `CRON_SECRET` and (optionally)
   `ANTHROPIC_API_KEY` and `SCRAPER_USER_AGENT`.
5. Create the tables once, from your machine:
   ```bash
   DATABASE_URL="postgres://..." npm run db:migrate
   ```
6. Redeploy. The cron job appears under **Settings → Cron Jobs**.

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`.

## Notes and next steps

- **Legal:** scraping public pages is common, but check each site's terms. Some restaurants may object to
  automated access. Honour opt-out requests, and prefer official APIs or partnerships as you grow.
- **Public Overpass servers are sometimes overloaded.** Discovery retries automatically. For production,
  consider a self-hosted Overpass instance or caching OSM extracts.
- Ideas: ICA/Coop/Lidl grocery adapters; users adding favourite restaurants by URL; a weekly email via Resend
  on Monday mornings; dietary filters; a map view; PWA push notifications.

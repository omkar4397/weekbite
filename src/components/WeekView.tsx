import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Location, Section } from "@/db/schema";
import { currentWeekDates, currentWeekKey, todayIsoWeekday } from "@/lib/week";
import { offersForLocation, getDigest, sourcesForLocation, type OfferView } from "@/services/digest";
import { DigestCard } from "@/components/DigestCard";
import { LunchWeek } from "@/components/LunchWeek";
import { GroceryDeals } from "@/components/GroceryDeals";
import { FastFoodDeals } from "@/components/FastFoodDeals";

export const SECTION_TABS: { key: Section; label: string }[] = [
  { key: "lunch", label: "🍽️ Lunch & restaurants" },
  { key: "grocery", label: "🛒 Grocery deals" },
  { key: "fastfood", label: "🍔 Fast food chains" },
];

export function parseSection(v: string | string[] | undefined): Section {
  return SECTION_TABS.find((s) => s.key === v)?.key ?? "lunch";
}

const NOUNS: Record<Section, { sources: string; offers: string }> = {
  lunch: { sources: "restaurants", offers: "lunch menus" },
  grocery: { sources: "stores", offers: "grocery deals" },
  fastfood: { sources: "fast food places", offers: "fast food deals" },
};

async function SourceStatus({ location, section }: { location: Location; section: Section }) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.sources.lastStatus, week: schema.sources.lastScrapedWeek, section: schema.sources.section })
    .from(schema.locationSources)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.locationSources.sourceId))
    .where(eq(schema.locationSources.locationId, location.id));
  const mine = rows.filter((r) => r.section === section);
  const done = mine.filter((r) => r.week === currentWeekKey());
  const withOffers = done.filter((r) => r.status?.startsWith("ok"));
  const noun = NOUNS[section].sources;
  return (
    <p className="text-xs text-muted">
      Checked {done.length}/{mine.length} {noun} this week · {withOffers.length} had offers
      {done.length < mine.length && " · still collecting, refresh in a few minutes"}
    </p>
  );
}

async function Digest({ location, section, offers }: { location: Location; section: Section; offers: OfferView[] }) {
  const digest = await getDigest(location, section, offers);
  return <DigestCard digest={digest} offers={offers} />;
}

export type PlaceChip = { key: string; label: string };

/**
 * One location's week: section tabs, place chips, collection status, the
 * weekly summary and the offers. Used by the dashboard and the public start page.
 */
export async function WeekView({
  location,
  section,
  chips,
  activeKey,
  href,
}: {
  location: Location;
  section: Section;
  chips: PlaceChip[];
  activeKey: string;
  href: (p: { section?: Section; key?: string }) => string;
}) {
  const offers = await offersForLocation(location, section);
  const places = section === "fastfood" ? await sourcesForLocation(location, section) : [];
  const dates = currentWeekDates();

  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-x-auto border-b border-line">
        {SECTION_TABS.map((s) => (
          <Link
            key={s.key}
            href={href({ section: s.key })}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 font-medium ${
              s.key === section ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Link
            key={c.key}
            href={href({ key: c.key })}
            className={`rounded-full border px-3 py-1 text-sm ${
              c.key === activeKey ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"
            }`}
          >
            📍 {c.label}
          </Link>
        ))}
        <Suspense>
          <SourceStatus location={location} section={section} />
        </Suspense>
      </div>

      <Suspense fallback={<div className="card p-5 animate-pulse text-muted">✨ Writing the weekly summary…</div>}>
        <Digest location={location} section={section} offers={offers} />
      </Suspense>

      {section === "fastfood" ? (
        <FastFoodDeals offers={offers} places={places} />
      ) : offers.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          No {NOUNS[section].offers} found near {location.label} yet this week.
          <br />
          We&apos;re checking every day. Newly added places take a few minutes.
        </div>
      ) : section === "lunch" ? (
        <LunchWeek offers={offers} days={location.days} dates={dates} today={todayIsoWeekday()} />
      ) : (
        <GroceryDeals offers={offers} />
      )}
    </div>
  );
}

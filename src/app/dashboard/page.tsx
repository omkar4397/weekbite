import Link from "next/link";
import { Suspense } from "react";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Location, Section } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { currentWeekDates, currentWeekKey, todayIsoWeekday, weekNumber } from "@/lib/week";
import { refreshMyOffers } from "@/app/actions/locations";
import { offersForLocation, getDigest, type OfferView } from "@/services/digest";
import { DigestCard } from "@/components/DigestCard";
import { LunchWeek } from "@/components/LunchWeek";
import { GroceryDeals } from "@/components/GroceryDeals";

export const maxDuration = 300;

const SECTIONS: { key: Section; label: string }[] = [
  { key: "lunch", label: "🍽️ Lunch & restaurants" },
  { key: "grocery", label: "🛒 Grocery deals" },
];

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
  const noun = section === "lunch" ? "restaurants" : "stores";
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

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const sp = await searchParams;
  const section: Section = sp.section === "grocery" ? "grocery" : "lunch";
  const db = await getDb();
  const locs = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.userId, user.id))
    .orderBy(asc(schema.locations.createdAt));

  if (!locs.length) {
    return (
      <div className="card p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold">Add your first location</h1>
        <p className="text-muted">Tell us where you usually are during the week, and we&apos;ll find the offers around it.</p>
        <Link href="/locations" className="btn">Add a location</Link>
      </div>
    );
  }

  const location = locs.find((l) => String(l.id) === sp.loc) ?? locs[0];
  const offers = await offersForLocation(location, section);
  const dates = currentWeekDates();
  const weekKey = currentWeekKey();
  const href = (p: { section?: Section; loc?: number }) =>
    `/dashboard?section=${p.section ?? section}&loc=${p.loc ?? location.id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Week {weekNumber(weekKey)} · {dates[0].date} – {dates[6].date}
          </p>
          <h1 className="text-3xl font-bold">Hi {user.name}, here&apos;s your food week</h1>
        </div>
        <form action={refreshMyOffers}>
          <button className="btn-ghost">↻ Refresh offers</button>
        </form>
      </div>

      <div className="flex gap-2 border-b border-line">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={href({ section: s.key })}
            className={`-mb-px border-b-2 px-4 py-2 font-medium ${
              s.key === section ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {locs.map((l) => (
          <Link
            key={l.id}
            href={href({ loc: l.id })}
            className={`rounded-full border px-3 py-1 text-sm ${
              l.id === location.id ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"
            }`}
          >
            📍 {l.label}
          </Link>
        ))}
        <Suspense>
          <SourceStatus location={location} section={section} />
        </Suspense>
      </div>

      <Suspense fallback={<div className="card p-5 animate-pulse text-muted">✨ Writing your weekly summary…</div>}>
        <Digest location={location} section={section} offers={offers} />
      </Suspense>

      {offers.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          No {section === "lunch" ? "lunch menus" : "grocery deals"} found near {location.label} yet this week.
          <br />
          We&apos;re checking every day. Newly added locations take a few minutes.
        </div>
      ) : section === "lunch" ? (
        <LunchWeek offers={offers} days={location.days} dates={dates} today={todayIsoWeekday()} />
      ) : (
        <GroceryDeals offers={offers} />
      )}
    </div>
  );
}

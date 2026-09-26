import Link from "next/link";
import { after } from "next/server";
import type { Location } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { featuredLocations, locationBySlug } from "@/lib/guest";
import { currentWeekDates, currentWeekKey, weekNumber } from "@/lib/week";
import { discoverForLocation } from "@/services/discovery";
import { scrapeAndDigest } from "@/services/pipeline";
import { WeekView, parseSection } from "@/components/WeekView";
import { ExploreForm } from "@/components/ExploreForm";

export const maxDuration = 300;

// One background discovery per place per server instance.
const discovering = new Set<number>();

/** Demo areas start empty; the first visit finds what's around them and collects offers. */
function ensureCollected(location: Location) {
  if (location.discoveredAt || discovering.has(location.id)) return;
  discovering.add(location.id);
  after(async () => {
    try {
      await discoverForLocation(location);
      await scrapeAndDigest([location.id]);
    } finally {
      discovering.delete(location.id);
    }
  });
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const section = parseSection(sp.section);
  const placeParam = typeof sp.place === "string" ? sp.place : undefined;
  const [featured, user] = await Promise.all([featuredLocations(), getCurrentUser()]);
  const searched = placeParam && !featured.some((f) => f.slug === placeParam) ? await locationBySlug(placeParam) : null;
  const location = searched ?? featured.find((f) => f.slug === placeParam) ?? featured[0];
  ensureCollected(location);

  const chips = [...(searched ? [searched] : []), ...featured].map((l) => ({ key: l.slug!, label: l.label }));
  const dates = currentWeekDates();

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <p className="text-sm text-muted">
          Week {weekNumber(currentWeekKey())} · {dates[0].date} – {dates[6].date}
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          This week&apos;s food deals near the places <span className="text-brand">you actually spend your week</span>.
        </h1>
        <p className="max-w-3xl text-muted">
          WeekBite collects lunch menus, grocery deals and fast food offers around a place and sums up the week. Look around a
          demo area below or try any address, no account needed.{" "}
          {user ? (
            <Link href="/dashboard" className="underline">Go to your own places →</Link>
          ) : (
            <>
              <Link href="/signup" className="underline">Create a free account</Link> to save your office, home and gym with the
              days you&apos;re there.
            </>
          )}
        </p>
        <ExploreForm section={section} />
      </section>

      <WeekView
        location={location}
        section={section}
        chips={chips}
        activeKey={location.slug!}
        href={(p) => `/?place=${p.key ?? location.slug}&section=${p.section ?? section}`}
      />
    </div>
  );
}

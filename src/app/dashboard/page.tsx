import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { currentWeekDates, currentWeekKey, weekNumber } from "@/lib/week";
import { refreshMyOffers } from "@/app/actions/locations";
import { WeekView, parseSection } from "@/components/WeekView";

export const maxDuration = 300;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const sp = await searchParams;
  const section = parseSection(sp.section);
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
  const dates = currentWeekDates();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Week {weekNumber(currentWeekKey())} · {dates[0].date} – {dates[6].date}
          </p>
          <h1 className="text-3xl font-bold">Hi {user.name}, here&apos;s your food week</h1>
        </div>
        <form action={refreshMyOffers}>
          <button className="btn-ghost">↻ Refresh offers</button>
        </form>
      </div>
      <WeekView
        location={location}
        section={section}
        chips={locs.map((l) => ({ key: String(l.id), label: l.label }))}
        activeKey={String(location.id)}
        href={(p) => `/dashboard?section=${p.section ?? section}&loc=${p.key ?? location.id}`}
      />
    </div>
  );
}

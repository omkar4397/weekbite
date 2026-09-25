import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { LocationForm } from "@/components/LocationForm";
import { LocationCard } from "@/components/LocationCard";

// Adding a location scrapes nearby places in the background via after().
export const maxDuration = 300;

export default async function LocationsPage({ searchParams }: PageProps<"/locations">) {
  const user = await requireUser();
  const { welcome } = await searchParams;
  const db = await getDb();
  const locs = await db
    .select({
      location: schema.locations,
      restaurants: sql<number>`count(*) filter (where ${schema.sources.section} = 'lunch')`.mapWith(Number),
      stores: sql<number>`count(*) filter (where ${schema.sources.section} = 'grocery')`.mapWith(Number),
    })
    .from(schema.locations)
    .leftJoin(schema.locationSources, eq(schema.locationSources.locationId, schema.locations.id))
    .leftJoin(schema.sources, eq(schema.sources.id, schema.locationSources.sourceId))
    .where(eq(schema.locations.userId, user.id))
    .groupBy(schema.locations.id)
    .orderBy(asc(schema.locations.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My locations</h1>
        <p className="text-muted">
          {welcome
            ? `Welcome, ${user.name}! Add the places you're usually at during the week to get started.`
            : "The places you spend your week at. We track offers within walking distance of each one."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {locs.map(({ location: l, restaurants, stores }) => (
          <LocationCard
            key={l.id}
            id={l.id}
            label={l.label}
            address={l.address}
            radiusM={l.radiusM}
            days={l.days}
            restaurants={restaurants}
            stores={stores}
          />
        ))}
      </div>
      <LocationForm />
      {locs.length > 0 && (
        <Link href="/dashboard" className="btn">See this week&apos;s offers →</Link>
      )}
    </div>
  );
}

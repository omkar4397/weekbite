import type { OfferView } from "@/lib/offers";
import type { NearbySource } from "@/services/digest";
import { VENUE_TAG } from "@/scrapers/venues";

const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

/** Why a place has no deals listed, in plain words. */
function noDealsReason(s: NearbySource) {
  if (!s.checkedThisWeek) return "Checking…";
  const st = s.status ?? "";
  if (st.startsWith("no website")) return "No website";
  if (/HTTP 403|robots/i.test(st)) return "Site doesn't allow automated reading";
  if (st.startsWith("error")) return "Site unavailable";
  return "No deals found online";
}

function DealCard({ o }: { o: OfferView }) {
  return (
    <div className="card p-3 flex flex-col gap-1 text-sm">
      {o.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.imageUrl} alt="" className="h-24 w-full object-contain" loading="lazy" />
      )}
      <div className="font-medium leading-tight">{o.title}</div>
      {o.description && <div className="text-xs text-muted line-clamp-3">{o.description}</div>}
      <div className="mt-auto flex items-baseline justify-between pt-1">
        {o.priceText ? (
          <span className="font-bold text-brand">{o.priceText}</span>
        ) : o.url ? (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
            {o.tags.includes("campaign") ? "See campaign" : "See deal"}
          </a>
        ) : (
          <span className="text-muted">Price not listed</span>
        )}
        {o.savingsSek != null && <span className="text-xs text-good">−{o.savingsSek} kr</span>}
      </div>
      {(o.tags.length > 0 || o.validTo) && (
        <div className="text-[11px] text-muted">
          {o.tags.join(", ")}
          {o.tags.length > 0 && o.validTo && " · "}
          {o.validTo && `until ${o.validTo}`}
        </div>
      )}
    </div>
  );
}

/** Fast food near a location: places with deals first (nearest first), then the rest as a list. */
export function FastFoodDeals({ offers, places }: { offers: OfferView[]; places: NearbySource[] }) {
  const bySource = Map.groupBy(offers, (o) => o.sourceId);
  const venues = places.filter((p) => p.provider === "venue");
  const others = places.filter((p) => p.provider !== "venue");
  const withDeals = others.filter((p) => bySource.has(p.id));
  const without = others.filter((p) => !bySource.has(p.id));
  // "Ikki" is listed by the venue too -> show "in Kista Galleria" next to it.
  const same = (a: string, b: string) => {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
  };
  const venueOf = (name: string) => venues.find((v) => (bySource.get(v.id) ?? []).some((r) => same(r.title, name)))?.name;

  if (!places.length) {
    return (
      <div className="card p-8 text-center text-muted">
        No fast food places found nearby yet. Newly added places take a few minutes, so check back shortly.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {venues.map((v) => {
        const restaurants = (bySource.get(v.id) ?? []).filter((o) => o.tags.includes(VENUE_TAG));
        return (
          <section key={v.id} className="card p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">🏬 {v.name}</h2>
              <span className="text-sm text-muted">
                {km(v.distanceM)}
                {v.url && (
                  <>
                    {" · "}
                    <a href={v.url} target="_blank" rel="noopener noreferrer" className="underline">
                      all restaurants
                    </a>
                  </>
                )}
              </span>
            </div>
            {restaurants.length ? (
              <div className="flex flex-wrap gap-2">
                {restaurants.map((r) => (
                  <a
                    key={r.id}
                    href={r.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.description ?? undefined}
                    className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand"
                  >
                    {r.title}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{v.checkedThisWeek ? "Couldn't read the restaurant list." : "Checking…"}</p>
            )}
          </section>
        );
      })}

      {withDeals.map((p) => (
        <section key={p.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <span className="text-sm text-muted">
              {p.provider === "chain" ? "Nearest branch " : ""}
              {km(p.distanceM)}
              {p.url && (
                <>
                  {" · "}
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {p.provider === "chain" ? "deals page" : "website"}
                  </a>
                </>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {bySource
              .get(p.id)!
              .sort((a, b) => (a.priceSek ?? Infinity) - (b.priceSek ?? Infinity))
              .map((o) => (
                <DealCard key={o.id} o={o} />
              ))}
          </div>
        </section>
      ))}

      {without.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            {withDeals.length ? "Also nearby" : "Fast food nearby"}{" "}
            <span className="text-sm font-normal text-muted">· no online deals this week</span>
          </h2>
          <ul className="card divide-y divide-line text-sm">
            {without.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      {p.name}
                    </a>
                  ) : (
                    <span className="font-medium">{p.name}</span>
                  )}
                  {p.address && <span className="text-muted"> · {p.address}</span>}
                  {venueOf(p.name) && <span className="text-muted"> · in {venueOf(p.name)}</span>}
                </span>
                <span className="text-xs text-muted">
                  {km(p.distanceM)} · {noDealsReason(p)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

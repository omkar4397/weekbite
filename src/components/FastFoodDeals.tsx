import type { OfferView } from "@/lib/offers";
import type { NearbySource } from "@/services/digest";

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
        <span className="font-bold text-brand">{o.priceText ?? "See deal"}</span>
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
  const withDeals = places.filter((p) => bySource.has(p.id));
  const without = places.filter((p) => !bySource.has(p.id));

  if (!places.length) {
    return (
      <div className="card p-8 text-center text-muted">
        No fast food places found nearby yet. Newly added locations take a few minutes — try ↻ Refresh offers.
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

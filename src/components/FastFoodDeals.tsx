import type { OfferView } from "@/lib/offers";

/** Fast food deals grouped by chain, nearest chain first. */
export function FastFoodDeals({ offers }: { offers: OfferView[] }) {
  const chains = [...Map.groupBy(offers, (o) => o.sourceId).values()].sort((a, b) => a[0].distanceM - b[0].distanceM);

  return (
    <div className="space-y-6">
      {chains.map((deals) => {
        const chain = deals[0];
        return (
          <section key={chain.sourceId} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{chain.sourceName}</h2>
              <span className="text-sm text-muted">
                Nearest branch {(chain.distanceM / 1000).toFixed(1)} km
                {chain.sourceUrl && (
                  <>
                    {" · "}
                    <a href={chain.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      deals page
                    </a>
                  </>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {deals
                .sort((a, b) => (a.priceSek ?? Infinity) - (b.priceSek ?? Infinity))
                .map((o) => (
                  <div key={o.id} className="card p-3 flex flex-col gap-1 text-sm">
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
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

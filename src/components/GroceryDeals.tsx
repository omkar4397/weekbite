"use client";

import { useMemo, useState } from "react";
import { dedupeOffers, type OfferView } from "@/lib/offers";

export function GroceryDeals({ offers }: { offers: OfferView[] }) {
  const stores = useMemo(
    () =>
      [...new Map(offers.map((o) => [o.sourceId, { id: o.sourceId, name: o.sourceName, distanceM: o.distanceM }])).values()]
        .sort((a, b) => a.distanceM - b.distanceM),
    [offers],
  );
  const [store, setStore] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(48);

  const shown = useMemo(
    () =>
      dedupeOffers(store === "all" ? offers : offers.filter((o) => o.sourceId === store))
        .filter((o) => !query || `${o.title} ${o.description ?? ""}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (b.savingsSek ?? 0) - (a.savingsSek ?? 0)),
    [offers, store, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search deals, e.g. kaffe"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input max-w-xs"
          value={store}
          onChange={(e) => setStore(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All stores ({stores.length})</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {(s.distanceM / 1000).toFixed(1)} km
            </option>
          ))}
        </select>
        <span className="self-center text-sm text-muted">{shown.length} deals</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.slice(0, limit).map((o) => (
          <div key={o.id} className="card p-3 flex flex-col gap-1 text-sm">
            {o.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.imageUrl} alt="" className="h-24 w-full object-contain" loading="lazy" />
            )}
            <div className="font-medium leading-tight">{o.title}</div>
            {o.description && <div className="text-xs text-muted line-clamp-2">{o.description}</div>}
            <div className="mt-auto flex items-baseline justify-between pt-1">
              <span className="font-bold text-brand">{o.priceText}</span>
              {o.savingsSek != null && <span className="text-xs text-good">−{o.savingsSek} kr</span>}
            </div>
            <div className="text-[11px] text-muted" title={o.stores.map((s) => s.name).join("\n")}>
              {o.stores[0].name}
              {o.stores.length > 1 && ` +${o.stores.length - 1} more`}
              {o.validTo && ` · until ${o.validTo}`}
              {o.tags.length > 0 && ` · ${o.tags.join(", ")}`}
            </div>
          </div>
        ))}
      </div>
      {shown.length > limit && (
        <button className="btn-ghost" onClick={() => setLimit(limit + 48)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}

import type { OfferView } from "@/services/digest";

type Day = { n: number; short: string; date: string };

function groupBySource(offers: OfferView[]) {
  const groups = new Map<number, OfferView[]>();
  for (const o of offers) groups.set(o.sourceId, [...(groups.get(o.sourceId) ?? []), o]);
  return [...groups.values()].sort((a, b) => a[0].distanceM - b[0].distanceM);
}

function Restaurant({ items }: { items: OfferView[] }) {
  const r = items[0];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <a href={r.url ?? r.sourceUrl ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:text-brand">
          {r.sourceName}
        </a>
        <span className="text-xs text-muted whitespace-nowrap">{r.distanceM} m</span>
      </div>
      <ul className="space-y-0.5 text-sm">
        {items.map((o) => (
          <li key={o.id} className="flex justify-between gap-3">
            <span>
              {o.title}
              {o.description && <span className="text-muted"> — {o.description}</span>}
              {o.tags.map((t) => (
                <span key={t} className="ml-1 rounded bg-brand-soft px-1 text-[10px] uppercase text-brand">{t}</span>
              ))}
            </span>
            {o.priceSek != null && <span className="whitespace-nowrap text-muted">{o.priceSek} kr</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LunchWeek({ offers, days, dates, today }: { offers: OfferView[]; days: number[]; dates: Day[]; today: number }) {
  const allWeek = offers.filter((o) => o.day == null);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {dates
          .filter((d) => days.includes(d.n))
          .map((d) => {
            const dayOffers = offers.filter((o) => o.day === d.n);
            const isToday = d.n === today;
            return (
              <section
                key={d.n}
                className={`card p-4 space-y-3 ${isToday ? "ring-2 ring-brand" : ""} ${d.n < today ? "opacity-60" : ""}`}
              >
                <h3 className="font-semibold">
                  {d.short} <span className="text-muted font-normal text-sm">{d.date.slice(5)}</span>
                  {isToday && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-white">Today</span>}
                </h3>
                {dayOffers.length ? (
                  groupBySource(dayOffers).map((items) => <Restaurant key={items[0].sourceId} items={items} />)
                ) : (
                  <p className="text-sm text-muted">No day-specific dishes found — see the all-week menus below.</p>
                )}
              </section>
            );
          })}
      </div>
      {allWeek.length > 0 && (
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold">Every day this week</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {groupBySource(allWeek).map((items) => <Restaurant key={items[0].sourceId} items={items} />)}
          </div>
        </section>
      )}
    </div>
  );
}

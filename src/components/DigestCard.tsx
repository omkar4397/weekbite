import type { DigestContent } from "@/db/schema";
import type { OfferView } from "@/services/digest";

export function DigestCard({ digest, offers }: { digest: DigestContent | null; offers: OfferView[] }) {
  if (!digest) return null;
  const byId = new Map(offers.map((o) => [o.id, o]));
  return (
    <section className="card border-brand/40 bg-brand-soft/40 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">{digest.headline}</h2>
        <span className="text-xs text-muted">{digest.generatedBy === "claude" ? "✨ AI summary" : "Summary"}</span>
      </div>
      <p className="text-sm leading-relaxed">{digest.summary}</p>
      {digest.picks.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {digest.picks.map((p) => {
            const o = byId.get(p.offerId);
            if (!o) return null;
            return (
              <li key={p.offerId} className="rounded-xl bg-card border border-line p-3 text-sm">
                <div className="font-medium">⭐ {o.title}</div>
                <div className="text-muted">
                  {o.sourceName}
                  {o.priceSek != null && ` · ${o.priceSek} kr`}
                </div>
                <div className="text-xs mt-1">{p.reason}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

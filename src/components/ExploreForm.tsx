"use client";

import { useActionState } from "react";
import { explorePlace, type ExploreState } from "@/app/actions/explore";

export function ExploreForm({ section }: { section: string }) {
  const [state, action, pending] = useActionState<ExploreState, FormData>(explorePlace, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="section" value={section} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="address"
          required
          minLength={3}
          className="input flex-1"
          placeholder="Try any address in Sweden, e.g. Drottninggatan 50, Stockholm"
          aria-label="Address"
        />
        <button className="btn" disabled={pending}>
          {pending ? "Looking around…" : "Show deals near it"}
        </button>
      </div>
      {pending && <p className="text-xs text-muted">Finding restaurants, stores and fast food nearby. This takes about 10 seconds.</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

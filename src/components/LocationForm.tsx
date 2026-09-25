"use client";

import { useActionState } from "react";
import { addLocation } from "@/app/actions/locations";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function LocationForm() {
  const [state, action, pending] = useActionState(addLocation, undefined);
  return (
    <form action={action} className="card p-5 space-y-4">
      <h2 className="font-semibold text-lg">Add a place you spend time at</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label className="space-y-1 text-sm">
          <span>Name</span>
          <input name="label" className="input" placeholder="Office" required maxLength={40} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Address</span>
          <input name="address" className="input" placeholder="Kungsgatan 10, Stockholm" required />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <fieldset className="space-y-1 text-sm">
          <legend>Days you&apos;re usually here</legend>
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <label key={d} className="cursor-pointer">
                <input type="checkbox" name="days" value={i + 1} defaultChecked={i < 5} className="peer sr-only" />
                <span className="inline-block rounded-md border border-line px-2.5 py-1 peer-checked:bg-brand peer-checked:text-white peer-checked:border-brand">
                  {d}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1 text-sm">
          <span>Walking distance</span>
          <select name="radiusM" defaultValue="800" className="input">
            <option value="400">~5 min (400 m)</option>
            <option value="800">~10 min (800 m)</option>
            <option value="1200">~15 min (1.2 km)</option>
            <option value="2000">Bike / short drive (2 km)</option>
          </select>
        </label>
        <button className="btn" disabled={pending}>{pending ? "Finding places nearby…" : "Add location"}</button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
    </form>
  );
}

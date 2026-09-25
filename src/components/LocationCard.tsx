"use client";

import { useTransition } from "react";
import { deleteLocation, updateLocationDays } from "@/app/actions/locations";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function LocationCard(props: {
  id: number;
  label: string;
  address: string;
  radiusM: number;
  days: number[];
  restaurants: number;
  stores: number;
}) {
  const [pending, start] = useTransition();
  const toggle = (d: number) => {
    const next = props.days.includes(d) ? props.days.filter((x) => x !== d) : [...props.days, d];
    if (next.length) start(() => updateLocationDays(props.id, next));
  };
  return (
    <div className={`card p-5 space-y-3 ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">📍 {props.label}</h3>
          <p className="text-sm text-muted">{props.address} · within {props.radiusM} m</p>
        </div>
        <button
          className="text-sm text-muted hover:text-red-600"
          onClick={() => confirm(`Remove ${props.label}?`) && start(() => deleteLocation(props.id))}
        >
          Remove
        </button>
      </div>
      <div className="flex gap-1">
        {DAYS.map((d, i) => (
          <button
            key={d}
            onClick={() => toggle(i + 1)}
            className={`rounded-md border px-2.5 py-1 text-sm ${
              props.days.includes(i + 1) ? "bg-brand text-white border-brand" : "border-line text-muted"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        Tracking {props.restaurants} restaurants and {props.stores} grocery stores nearby.
      </p>
    </div>
  );
}

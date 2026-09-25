import { fetchJson } from "./http";

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

type NominatimHit = { lat: string; lon: string; display_name: string };

/** Geocode a free-text address with OpenStreetMap Nominatim (Sweden only). */
export async function geocode(address: string) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=se&q=" +
    encodeURIComponent(address);
  const hits = await fetchJson<NominatimHit[]>(url);
  if (!hits.length) return null;
  return { lat: Number(hits[0].lat), lng: Number(hits[0].lon), displayName: hits[0].display_name };
}

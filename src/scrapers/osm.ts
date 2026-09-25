/** Discover restaurants with a website near a point using OpenStreetMap (Overpass API). */
import { politeFetch } from "@/lib/http";
import { distanceM } from "@/lib/geo";

// Public Overpass instances are often overloaded, so fall back through mirrors.
const OVERPASS_URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

async function overpass(query: string) {
  let lastError: unknown;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await politeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      }, 15_000);
      if (res.ok) return (await res.json()) as { elements: OverpassElement[] };
      lastError = new Error(`Overpass HTTP ${res.status} (${url})`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type Restaurant = {
  osmId: string;
  name: string;
  website: string;
  cuisine: string | null;
  address: string | null;
  lat: number;
  lng: number;
  distanceM: number;
};

type NominatimPlace = {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name: string;
  extratags?: Record<string, string> | null;
  address?: Record<string, string>;
};

/** Fallback when Overpass is down: Nominatim amenity search inside a bounding box. */
async function nominatimRestaurants(point: { lat: number; lng: number }, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  const viewbox = [point.lng - dLng, point.lat + dLat, point.lng + dLng, point.lat - dLat].join(",");
  const elements: OverpassElement[] = [];
  for (const amenity of ["restaurant", "cafe", "fast_food"]) {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&amenity=${amenity}` +
      `&viewbox=${viewbox}&bounded=1&extratags=1&addressdetails=1&limit=50`;
    const res = await politeFetch(url, {}, 15_000);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    for (const p of (await res.json()) as NominatimPlace[]) {
      elements.push({
        type: p.osm_type as OverpassElement["type"],
        id: p.osm_id,
        lat: Number(p.lat),
        lon: Number(p.lon),
        tags: {
          ...p.extratags,
          name: p.name,
          "addr:street": p.address?.road ?? "",
          "addr:housenumber": p.address?.house_number ?? "",
          "addr:city": p.address?.city ?? p.address?.town ?? "",
        },
      });
    }
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim usage policy: max 1 request/second
  }
  return elements;
}

export async function restaurantsNear(point: { lat: number; lng: number }, radiusM: number, limit = 40) {
  const query = `[out:json][timeout:25];
nwr(around:${radiusM},${point.lat},${point.lng})[amenity~"^(restaurant|cafe|fast_food|food_court)$"][~"^(website|contact:website)$"~"."];
out center 200;`;
  let elements: OverpassElement[];
  try {
    elements = (await overpass(query)).elements;
  } catch (e) {
    console.warn("Overpass unavailable, falling back to Nominatim:", (e as Error).message);
    elements = await nominatimRestaurants(point, radiusM);
  }

  const seen = new Set<string>();
  const out: Restaurant[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const website = t.website ?? t["contact:website"];
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!t.name || !website || lat == null || lng == null) continue;
    let url: URL;
    try {
      url = new URL(/^https?:\/\//.test(website) ? website : `https://${website}`);
    } catch {
      continue;
    }
    // Chains often share one website; scrape it once per location. Operators such as
    // Compass Group host many restaurants under different paths, so keep the path.
    const key = url.host + (url.pathname.length > 1 ? url.pathname : "");
    if (seen.has(key)) continue;
    seen.add(key);
    const dist = distanceM(point, { lat, lng });
    if (dist > radiusM) continue;
    const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
    out.push({
      osmId: `${el.type}/${el.id}`,
      name: t.name,
      website: url.toString(),
      cuisine: t.cuisine?.replace(/_/g, " ").replace(/;/g, ", ") ?? null,
      address: [street, t["addr:city"]].filter(Boolean).join(", ") || null,
      lat,
      lng,
      distanceM: dist,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
}

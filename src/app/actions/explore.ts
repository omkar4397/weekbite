"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { geocode } from "@/lib/geo";
import { guestPlaceFor } from "@/lib/guest";
import { discoverForLocation } from "@/services/discovery";
import { scrapeAndDigest } from "@/services/pipeline";

export type ExploreState = { error?: string } | undefined;

/** "Try any address" on the start page: no account needed. */
export async function explorePlace(_: ExploreState, formData: FormData): Promise<ExploreState> {
  const address = String(formData.get("address") ?? "").trim();
  const section = String(formData.get("section") ?? "lunch");
  if (address.length < 3 || address.length > 200) return { error: "Enter an address, e.g. 'Drottninggatan 1, Stockholm'." };

  const geo = await geocode(address).catch(() => null);
  if (!geo) return { error: "We couldn't find that address in Sweden. Try adding the city, e.g. 'Drottninggatan 1, Stockholm'." };

  const place = await guestPlaceFor(geo);
  if (!place) return { error: "Lots of searches right now. Have a look at the demo areas, or try again in a while." };

  if (!place.location.discoveredAt) await discoverForLocation(place.location);
  // Collecting this week's offers takes a few minutes; do it after responding.
  after(() => scrapeAndDigest([place.location.id]));
  redirect(`/?place=${place.location.slug}&section=${encodeURIComponent(section)}`);
}

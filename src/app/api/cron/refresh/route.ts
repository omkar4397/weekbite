import { NextResponse, type NextRequest } from "next/server";
import { refreshSources } from "@/services/refresh";
import { buildDigests } from "@/services/digest";
import { discoverForLocation, locationsNeedingDiscovery } from "@/services/discovery";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Daily Vercel Cron job (see vercel.json). Scrapes sources that lack this
 * week's offers, then rebuilds digests. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` automatically.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let rediscovered = 0;
  for (const loc of await locationsNeedingDiscovery(10)) {
    await discoverForLocation(loc);
    rediscovered++;
  }
  const refresh = await refreshSources({ limit: 150, budgetMs: 180_000 });
  const digests = await buildDigests(undefined, 70_000);
  return NextResponse.json({ rediscovered, refresh, digests });
}

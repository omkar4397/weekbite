/** Polite HTTP fetching for scrapers: identifying UA, timeouts, size cap, robots.txt. */

export const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  "WeekBiteBot/0.1 (+https://github.com/your-org/weekbite; weekly food offer digest)";

const MAX_BYTES = 3_000_000;

export async function politeFetch(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.5", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    cache: "no-store",
  });
  return res;
}

export async function fetchText(url: string) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error(`Response too large (${len} bytes)`);
  return { text: await res.text(), contentType: res.headers.get("content-type") ?? "", finalUrl: res.url };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await politeFetch(url, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchBytes(url: string) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES * 3) throw new Error("File too large");
  return buf;
}

const robotsCache = new Map<string, string[]>();

/** Minimal robots.txt check: honours Disallow rules for "*" and our bot name. */
export async function isAllowedByRobots(url: string) {
  const u = new URL(url);
  let rules = robotsCache.get(u.origin);
  if (!rules) {
    rules = [];
    try {
      const res = await politeFetch(`${u.origin}/robots.txt`, {}, 5000);
      if (res.ok) {
        let applies = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = raw.split("#")[0].trim();
          const [k, ...rest] = line.split(":");
          const v = rest.join(":").trim();
          if (/^user-agent$/i.test(k)) applies = v === "*" || /weekbite/i.test(v);
          else if (applies && /^disallow$/i.test(k) && v) rules.push(v);
        }
      }
    } catch {
      // unreachable robots.txt = no restrictions
    }
    robotsCache.set(u.origin, rules);
  }
  return !rules.some((r) => u.pathname.startsWith(r.replace(/\*.*$/, "")));
}

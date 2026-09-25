/** Week/date helpers, always evaluated in Swedish time. */

const TZ = "Europe/Stockholm";

export const WEEKDAYS = [
  { n: 1, short: "Mon", sv: "måndag" },
  { n: 2, short: "Tue", sv: "tisdag" },
  { n: 3, short: "Wed", sv: "onsdag" },
  { n: 4, short: "Thu", sv: "torsdag" },
  { n: 5, short: "Fri", sv: "fredag" },
  { n: 6, short: "Sat", sv: "lördag" },
  { n: 7, short: "Sun", sv: "söndag" },
] as const;

/** Calendar date (y, m, d) as seen in Stockholm right now. */
function stockholmToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

/** ISO weekday 1 (Mon) .. 7 (Sun) in Stockholm. */
export function todayIsoWeekday(now = new Date()) {
  const d = stockholmToday(now).getUTCDay();
  return d === 0 ? 7 : d;
}

/** e.g. "2026-W39" */
export function currentWeekKey(now = new Date()) {
  const d = stockholmToday(now);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday decides the ISO year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday..Sunday dates (YYYY-MM-DD) of the current week. */
export function currentWeekDates(now = new Date()) {
  const d = stockholmToday(now);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return WEEKDAYS.map((w) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + w.n - 1);
    return { ...w, date: x.toISOString().slice(0, 10) };
  });
}

export function weekNumber(weekKey: string) {
  return Number(weekKey.split("-W")[1]);
}

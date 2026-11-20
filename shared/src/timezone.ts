/** Rough city/country → IANA time zone map, for scheduling sends in the recipient's local time. */
const LOCATION_TZ: [RegExp, string][] = [
  [/\b(san francisco|sf|bay area|palo alto|mountain view|menlo park|san jose|sunnyvale|seattle|los angeles|la|portland|san diego|vancouver|california|\bca\b|washington state)\b/i, "America/Los_Angeles"],
  [/\b(denver|boulder|colorado|salt lake|phoenix|arizona)\b/i, "America/Denver"],
  [/\b(chicago|austin|dallas|houston|texas|minneapolis|illinois)\b/i, "America/Chicago"],
  [/\b(new york|nyc|ny\b|boston|miami|atlanta|washington,? dc|philadelphia|toronto|montreal|pittsburgh|massachusetts)\b/i, "America/New_York"],
  [/\b(são paulo|sao paulo|brazil|rio)\b/i, "America/Sao_Paulo"],
  [/\b(mexico city|mexico)\b/i, "America/Mexico_City"],
  [/\b(london|uk|united kingdom|england|manchester|edinburgh|dublin|ireland)\b/i, "Europe/London"],
  [/\b(berlin|munich|germany|paris|france|amsterdam|netherlands|madrid|spain|barcelona|stockholm|sweden|zurich|switzerland|vienna|copenhagen|oslo|warsaw|poland|milan|rome|italy|brussels|prague|lisbon)\b/i, "Europe/Berlin"],
  [/\b(helsinki|finland|tallinn|estonia|athens|greece|kyiv|ukraine|bucharest)\b/i, "Europe/Helsinki"],
  [/\b(tel aviv|israel)\b/i, "Asia/Jerusalem"],
  [/\b(dubai|uae|abu dhabi)\b/i, "Asia/Dubai"],
  [/\b(bangalore|bengaluru|mumbai|delhi|new delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|india)\b/i, "Asia/Kolkata"],
  [/\b(singapore)\b/i, "Asia/Singapore"],
  [/\b(jakarta|indonesia|bangkok|thailand|ho chi minh|vietnam)\b/i, "Asia/Bangkok"],
  [/\b(hong kong|shanghai|beijing|shenzhen|china|taipei|taiwan)\b/i, "Asia/Shanghai"],
  [/\b(tokyo|japan|seoul|korea)\b/i, "Asia/Tokyo"],
  [/\b(sydney|melbourne|australia)\b/i, "Australia/Sydney"],
  [/\b(auckland|new zealand)\b/i, "Pacific/Auckland"],
  [/\b(lagos|nigeria)\b/i, "Africa/Lagos"],
  [/\b(nairobi|kenya)\b/i, "Africa/Nairobi"],
  [/\b(cape town|johannesburg|south africa)\b/i, "Africa/Johannesburg"],
  [/\b(usa|united states|us\b|remote - us|us remote)\b/i, "America/New_York"],
  [/\b(europe|emea)\b/i, "Europe/Berlin"],
];

export function guessTimezone(location?: string | null, fallback = "UTC"): string {
  if (!location) return fallback;
  for (const [re, tz] of LOCATION_TZ) if (re.test(location)) return tz;
  return fallback;
}

/** Offset (minutes) of `tz` relative to UTC at instant `date`. */
export function tzOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Local wall-clock parts for an instant in a zone. */
export function localParts(tz: string, date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: weekdayIdx };
}

/** Convert a wall-clock time in `tz` to a UTC Date (handles DST by re-checking the offset). */
export function zonedTimeToUtc(tz: string, y: number, m: number, d: number, h: number, min = 0): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const off1 = tzOffsetMinutes(tz, guess);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(tz, first);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

export interface SendWindow {
  startHour: number; // local, inclusive
  endHour: number; // local, exclusive
  weekdaysOnly: boolean;
  preferredHour?: number; // e.g. 10 for "10 AM their time"
}

export const DEFAULT_SEND_WINDOW: SendWindow = { startHour: 9, endHour: 17, weekdaysOnly: true, preferredHour: 10 };

/**
 * Next good moment to send in the recipient's zone, on or after `notBefore`.
 * Uses the preferred hour when possible, otherwise anything inside the window.
 * `jitterMinutes` adds a random offset (0..jitter) so sends don't look robotic.
 */
export function nextSendTime(
  tz: string,
  notBefore: Date,
  window: SendWindow = DEFAULT_SEND_WINDOW,
  jitterMinutes = 0,
  rand: () => number = Math.random,
): Date {
  const target = window.preferredHour ?? window.startHour;
  for (let i = 0; i < 14; i++) {
    const probe = new Date(notBefore.getTime() + i * 86400000);
    const lp = localParts(tz, probe);
    const isWeekend = lp.weekday === 0 || lp.weekday === 6;
    if (window.weekdaysOnly && isWeekend) continue;
    const jitter = Math.floor(rand() * (jitterMinutes + 1));
    const candidate = new Date(zonedTimeToUtc(tz, lp.year, lp.month, lp.day, target, 0).getTime() + jitter * 60000);
    if (candidate >= notBefore) return candidate;
    // preferred slot already passed today: if still inside window, send soon-ish
    if (i === 0) {
      const nowLocal = localParts(tz, notBefore);
      if (nowLocal.hour >= window.startHour && nowLocal.hour < window.endHour - 1) {
        return new Date(notBefore.getTime() + (5 + jitter) * 60000);
      }
    }
  }
  return new Date(notBefore.getTime() + 86400000);
}

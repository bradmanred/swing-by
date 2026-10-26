// When the sun sets at a playground, worked out from its position and today's date, and shown in UK time.
// This replaces a fixed list of London times by month, which didn't know about the clocks changing or about
// the difference between (say) Cornwall and Edinburgh.
//
// The sums are the standard NOAA ones for sunrise and sunset (the sun's top edge on the horizon, allowing for
// refraction). They're good to about a minute in the UK, and the pages round to the nearest 5 minutes.
// "Dusk" on the site means sunset, as it did before. tests/dusk.mjs checks the results against an independent
// astronomy library for several places and dates, including the days the clocks change.

const rad = Math.PI / 180;
const deg = 180 / Math.PI;

/** Julian day number at 12:00 UT on a calendar date. */
function julianNoon(y: number, m: number, d: number) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** The sun's declination (radians) and the equation of time (minutes) at a Julian day. */
function sunAt(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps * rad) / 2) ** 2;
  const eqTime =
    4 *
    deg *
    (y * Math.sin(2 * l0 * rad) -
      2 * e * Math.sin(m * rad) +
      4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad) -
      0.5 * y * y * Math.sin(4 * l0 * rad) -
      1.25 * e * e * Math.sin(2 * m * rad));
  return { decl, eqTime };
}

/**
 * The moment of sunset on a calendar date at a position (longitude east is positive), or null if the sun
 * doesn't set that day (not a thing in the UK).
 */
export function sunset(lat: number, lng: number, y: number, m: number, d: number): Date | null {
  const jd = julianNoon(y, m, d);
  let minutes = 18 * 60; // first guess, in minutes after midnight UT; two rounds of refinement follow
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = sunAt(jd - 0.5 + minutes / 1440);
    const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (cosHa < -1 || cosHa > 1) return null;
    minutes = 720 - 4 * (lng - Math.acos(cosHa) * deg) - eqTime;
  }
  return new Date(Date.UTC(y, m - 1, d) + minutes * 60000);
}

const parts = (date: Date, timeZone: string, o: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, ...o }).formatToParts(date).map((p) => [p.type, p.value]));

/**
 * "Dusk is around 16:40 today." for a position, in UK time whatever time zone the visitor is in. Rounded to the
 * nearest 5 minutes, because "around" is the honest word: gates lock when someone gets to them.
 */
export function duskText(lat: number, lng: number, now: Date = new Date()): string {
  const day = parts(now, 'Europe/London', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const set = sunset(lat, lng, Number(day.year), Number(day.month), Number(day.day));
  if (!set) return '';
  const rounded = new Date(Math.round(set.getTime() / 300000) * 300000);
  const t = parts(rounded, 'Europe/London', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `Dusk is around ${t.hour}:${t.minute} today.`;
}

// Whether a council's playground record is a place we already list, or a separate one close by.
//
// Within 150 m usually means the same playground listed twice, but not always: an adventure playground is often a
// fenced site of its own next to a park's playground (Islington's Hayward and Lumpy Hill beside Caledonian Park,
// Martin Luther King beside Paradise Park). So a nearby listing only counts as the same place when:
// - it comes from OpenStreetMap alone (the council's record then replaces it), or
// - it is on the same OpenStreetMap play area the record was placed on, or
// - it is within 40 m (two separate sites are rarely that close), or
// - the two names share a distinctive word, or either has none ("Playground", "Play area").
// Otherwise two differently named places 40 to 150 m apart are both listed.
//
// A pin placed from a postcode, a street or a park's middle can be 200 to 300 m from the play area (Digswell Playing
// Fields' postcode pin was about 200 m from the playground), so when either side's pin is that rough, the same rules
// reach out to 300 m, except that "within 40 m" doesn't apply and, beyond 150 m, names must agree (share a word, or
// one side has no distinctive name).

export const SAME_M = 150;
export const CLOSE_M = 40;
export const ROUGH_M = 300;

/** Whether a listing's pin is only approximate, from its notConfirmed line ("Exact position (approximate: …)"). */
export function roughPin(notConfirmed) {
  const m = /^Exact position\s*\(([^)]*)\)/i.exec(String(notConfirmed ?? ''));
  if (!m) return false;
  if (/taken from OpenStreetMap|from the council's map\b(?!.*park)/i.test(m[1])) return false;
  return /approximate|postcode|street|road|centre|middle|park's point|car park/i.test(m[1]);
}
/** How far apart a listing and another place can be and still be the same playground. */
export const reachM = (a, b = {}) => (a?.rough || b?.rough ? ROUGH_M : SAME_M);

const NAME_SKIP = new Set(
  'play area areas playground playgrounds park parks the and of off gardens garden recreation ground open space common green field fields playing children childrens adventure kids'.split(' '),
);
export const nameWords = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !NAME_SKIP.has(w));

/** OpenStreetMap ids ('way/123') a listing cites as sources. */
/**
 * Whether two names could be the same place: they share a distinctive word, or either has none. Names we made up for
 * OpenStreetMap playgrounds without one ("Playground off Hertford Road") say where it is, not what it's called, so
 * they count as having none.
 */
export const madeUpName = (s) => /^playground off /i.test(String(s ?? '').trim());
export function namesAgree(x, y) {
  const a = new Set(madeUpName(x) ? [] : nameWords(x));
  const b = madeUpName(y) ? [] : nameWords(y);
  return !a.size || !b.length || b.some((w) => a.has(w));
}

export const osmIds = (sources) => (sources ?? []).map((s) => /openstreetmap\.org\/((?:node|way|relation)\/\d+)/.exec(s.url)?.[1]).filter(Boolean);

/**
 * rec: { name, osm?, rough? } (the council record, osm being the play area it was placed on);
 * listing: { name, osmOnly, osm: [ids], rough? }; metres: how far apart they are. rough: the pin is approximate.
 */
export function samePlace(rec, listing, metres) {
  if (rec.osm && (listing.osm ?? []).includes(rec.osm)) return true;
  if (metres >= reachM(rec, listing)) return false;
  if (metres >= SAME_M) return namesAgree(rec.name, listing.name);
  if (listing.osmOnly) return true;
  if (metres < CLOSE_M) return true;
  return namesAgree(rec.name, listing.name);
}

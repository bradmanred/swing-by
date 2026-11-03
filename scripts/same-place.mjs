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

export const SAME_M = 150;
export const CLOSE_M = 40;

const NAME_SKIP = new Set(
  'play area areas playground playgrounds park parks the and of off gardens garden recreation ground open space common green field fields playing children childrens adventure kids'.split(' '),
);
export const nameWords = (s) => String(s ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !NAME_SKIP.has(w));

/** OpenStreetMap ids ('way/123') a listing cites as sources. */
export const osmIds = (sources) => (sources ?? []).map((s) => /openstreetmap\.org\/((?:node|way|relation)\/\d+)/.exec(s.url)?.[1]).filter(Boolean);

/**
 * rec: { name, osm? } (the council record, osm being the play area it was placed on);
 * listing: { name, osmOnly, osm: [ids] }; metres: how far apart they are.
 */
export function samePlace(rec, listing, metres) {
  if (metres >= SAME_M) return false;
  if (listing.osmOnly) return true;
  if (rec.osm && (listing.osm ?? []).includes(rec.osm)) return true;
  if (metres < CLOSE_M) return true;
  const a = new Set(nameWords(rec.name));
  const b = nameWords(listing.name);
  if (!a.size || !b.length) return true;
  return b.some((w) => a.has(w));
}

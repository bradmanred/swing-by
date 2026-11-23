// What a playground mapped on OpenStreetMap can tell us, shared by the snapshot (scripts/osm-snapshot.mjs), the jobs
// that add Unverified playgrounds from it (scripts/find-gaps.mjs, scripts/junction-gaps.mjs), the pin check and the
// tidy job for playgrounds already listed from it (scripts/osm-tidy.mjs).
//
// - Which mapped playgrounds count as public: not tagged private, residents-only or indoor, not named as a school's,
//   pub's or hotel's, and (from the snapshot) not inside the grounds of a school, nursery, college, pub, hotel,
//   caravan site, campsite or holiday park.
// - The park a playground is in (its smallest named park, garden, common, recreation ground or nature reserve), so an
//   unnamed one is "Victoria Park Playground" rather than "Playground off Elm Road".
// - Equipment from the swings, slides and so on mapped inside it (playground=* points), and age ranges and step-free
//   access from its own tags. These go on the page as Unverified details: notConfirmed says they come from
//   OpenStreetMap and may be incomplete.

import { readFileSync } from 'node:fs';

const data = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
/**
 * Listings removed because they're inside school grounds (src/data/school-grounds.json), by OpenStreetMap id. They
 * wait for an official source: a council list that includes one is flagged by the coverage and quarterly checks.
 */
export const SCHOOL_GROUNDS = new Map(Object.entries(data('school-grounds.json').playgrounds));
/**
 * Mapped playgrounds never to add again from OpenStreetMap, by id: ones an official source says aren't public
 * (src/data/not-public.json), and the school-grounds ones above.
 */
export const NOT_PUBLIC = new Set([...Object.keys(data('not-public.json').playgrounds), ...SCHOOL_GROUNDS.keys()]);

export const BAD = /school|nursery|academy|primary|college|\bpub\b|inn\b|hotel|caravan|holiday park|soft play|ikea|mcdonald/i;
const CLOSED = new Set(['private', 'no', 'customers', 'residents', 'permit', 'students']);
/** Whether a mapped playground's own tags allow it: not private or indoor, and not named as a school's, pub's and so on. */
export const isPublic = (t = {}) => !CLOSED.has(t.access) && t.indoor !== 'yes' && !BAD.test(`${t.name ?? ''} ${t.operator ?? ''}`);
/** The same for a snapshot playground, which also knows whose grounds it is inside ("within"), and not one we've been told is private. */
export const isPublicPlay = (p) => isPublic(p.tags ?? {}) && !p.within && !NOT_PUBLIC.has(p.id);

/** The kind of grounds whose playgrounds aren't open to everyone, from an area's tags, or null. */
export function groundsKind(t = {}) {
  if (['school', 'kindergarten', 'college', 'university'].includes(t.amenity) || t.landuse === 'education') return 'school';
  if (t.amenity === 'pub') return 'pub';
  if (['hotel', 'motel'].includes(t.tourism)) return 'hotel';
  if (['caravan_site', 'camp_site', 'holiday_village'].includes(t.tourism) || t.leisure === 'resort') return 'holiday park';
  return null;
}
/** The open spaces a playground can be named after. */
export const PARK_KINDS = new Set(['park', 'garden', 'common', 'recreation_ground', 'nature_reserve']);

// playground=* values (https://wiki.openstreetmap.org/wiki/Key:playground) → the equipment codes in src/data/labels.json.
const EQUIPMENT = {
  swing: 'sw', baby_swing: 'bs', basketswing: 'bk', basket_swing: 'bk',
  slide: 'sl',
  climbingframe: 'cl', climbing_frame: 'cl', climbingwall: 'cl', climbing_wall: 'cl', climbing: 'cl', structure: 'cl', net: 'cl', climbing_net: 'cl',
  zipwire: 'zw', zip_wire: 'zw', zipline: 'zw',
  sandpit: 'sp', sand: 'sp',
  splash_pad: 'wp', splashpad: 'wp', water: 'wp', pump: 'wp', water_play: 'wp',
  roundabout: 'rb', basketrotator: 'rb', roundabout_inclusive: 'rb',
  spinner: 'spn', spinning_disc: 'spn', spinning_bowl: 'spn',
  seesaw: 'ss', see_saw: 'ss',
  springy: 'spr', spring_rider: 'spr', springer: 'spr',
  trampoline: 'tp',
  horizontal_ladder: 'mb', monkey_bars: 'mb', monkeybars: 'mb',
  balancebeam: 'bb', balance_beam: 'bb',
};
const ORDER = ['sw', 'bs', 'bk', 'sl', 'cl', 'mb', 'zw', 'rb', 'spn', 'ss', 'spr', 'tp', 'bb', 'sp', 'wp'];
/** The equipment code for one mapped item's tags, or null. A swing with a baby or basket seat counts as that. */
export function equipmentCode(t = {}) {
  const v = String(t.playground ?? '').toLowerCase().split(';')[0].trim();
  let code = EQUIPMENT[v] ?? null;
  if (code === 'sw' && (t.baby === 'yes' || /baby/.test(t['swing:seat'] ?? t.seat ?? ''))) code = 'bs';
  if (code === 'sw' && /basket|nest/.test(t['swing:seat'] ?? t.seat ?? '')) code = 'bk';
  return code;
}
/** Codes in a fixed order, without repeats. */
export const sortCodes = (codes) => ORDER.filter((c) => codes.includes(c));

const AGE_BANDS = [['under-3', 0, 2], ['3-6', 3, 6], ['7-12', 7, 12], ['teens', 13, 17]];
/** Age ranges from min_age and max_age (either may be missing; neither means none). */
export function agesFrom(t = {}) {
  const n = (v) => (/^\d{1,2}$/.test(String(v ?? '').trim()) ? Number(v) : null);
  let lo = n(t.min_age), hi = n(t.max_age);
  if (lo == null && hi == null) return [];
  lo ??= 0;
  hi ??= Math.max(lo, 12);
  if (hi < lo) return [];
  return AGE_BANDS.filter(([, a, b]) => a <= hi && b >= lo).map(([k]) => k);
}
/** Access codes from the playground's tags: wheelchair=yes is step-free access. */
export const accessFrom = (t = {}) => (t.wheelchair === 'yes' ? ['sf'] : []);

const GENERIC = /^(play(ground| area| park|park| space)?s?|children'?s play( area| ground|ground)?|play equipment)$/i;
// "Toddler Playground", "Junior Play Area": a kind of playground, not a name, so it goes with the park or street.
const KIND_ONLY = /^(toddlers?'?|juniors?'?|infants?'?|kids'?|children'?s|childrens|young children'?s|younger children'?s|older children'?s|teen|teenage|youth|under 5'?s|natural|adventure|inclusive|accessible|sensory)\s+(play(ground| area| park|park| space)?s?)$/i;
const PLAY_WORD = /\b(play\w*|adventure)\b/i;
const tidyCase = (s) => (s.length > 4 && s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m) => m.toUpperCase()) : s);
/**
 * The name for a playground listed from OpenStreetMap: its own name unless that's just "Playground", then the park it's
 * in ("Victoria Park Playground"), then the nearest street ("Playground off Elm Road"), then the place ("Sidmouth
 * Playground"). A name that only says what kind it is ("Toddler Playground") is kept, with the park or street.
 */
export function playgroundName({ tagName = '', park = '', road = '', place = '' }) {
  const own = tidyCase(String(tagName).trim());
  if (own && !GENERIC.test(own) && !KIND_ONLY.test(own)) return own;
  const kind = own && KIND_ONLY.test(own) ? own.replace(/(^|\s)([a-z])/g, (m) => m.toUpperCase()) : '';
  const pk = tidyCase(String(park).trim());
  if (pk) return kind ? `${pk} ${kind}` : PLAY_WORD.test(pk) ? pk : `${pk} Playground`;
  if (road) return `${kind || 'Playground'} off ${road}`;
  return `${place} ${kind || 'Playground'}`.trim();
}
/** The playground's own name from its tags, or '' when it only says "Playground" or what kind it is. */
export const ownName = (tagName = '') => {
  const own = tidyCase(String(tagName).trim());
  return own && !GENERIC.test(own) && !KIND_ONLY.test(own) ? own : '';
};
/** Whether a listing's name is one this job made up from a street or place, which a park's name improves on. */
export const madeUpName = (name, place = '') => /^Playground off /.test(name) || (!!place && name === `${place} Playground`) || KIND_ONLY.test(name);

/**
 * A new playground file for one mapped on OpenStreetMap. p: the snapshot (or Overpass) playground, with tags and,
 * from the snapshot, park, equip and within. road, place, area and region as the import jobs work them out.
 */
export function osmPlaygroundDoc(p, { road = '', place = '', area, region }) {
  const tags = p.tags ?? {};
  const tagName = (tags.name ?? '').trim();
  const park = p.park ?? '';
  const name = playgroundName({ tagName, park, road, place });
  const details = osmDetails(p);
  const near = [road, place].filter(Boolean).join(', ');
  const where = park && !name.includes(park) ? ` in ${park}` : '';
  return {
    name, region, area, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5,
    ages: details.ages, equipment: details.equipment, access: details.access, facilities: [], opens: '',
    description: osmDescription({ where, near, fee: details.fee }),
    nearby: [],
    ...(tags.operator ? { operator: tags.operator } : {}),
    sources: [{ label: `OpenStreetMap: ${tagName || 'playground'}`, url: `https://www.openstreetmap.org/${p.id}` }],
    checked: null,
    notConfirmed: osmNotConfirmed(details),
    photo: null,
  };
}
/** What OpenStreetMap says a playground has: { ages, equipment, access, fee }. */
export function osmDetails(p) {
  const tags = p.tags ?? {};
  const own = equipmentCode(tags);
  return {
    ages: agesFrom(tags),
    equipment: sortCodes([...(p.equip ?? []), ...(own ? [own] : [])]),
    access: accessFrom(tags),
    fee: tags.fee === 'yes', // only mentioned in the description: the page's "Paid entry" panel needs an official source
  };
}
/** The stock description of an OpenStreetMap-only playground. */
export function osmDescription({ where = '', near = '', fee = '' }) {
  return `A playground on OpenStreetMap${where}${near ? ` near ${near}` : ''}. No council list we've checked includes it yet, so we can't confirm it's open to everyone or what it has.${fee ? ' OpenStreetMap says there may be a charge to use it.' : ''}`;
}
export const OSM_DESCRIPTION = /^A playground on OpenStreetMap( in [^.]+?)?( near [^.]+)?\. No council list we've checked includes it yet/;
/** The notConfirmed text for an OpenStreetMap-only playground, saying which details came from OpenStreetMap. */
export function osmNotConfirmed({ ages = [], equipment = [] } = {}) {
  const parts = [
    'Exact position (taken from OpenStreetMap)',
    ages.length ? 'age ranges (from OpenStreetMap)' : 'age ranges',
    equipment.length ? 'play equipment (what is mapped on OpenStreetMap, which may be incomplete)' : 'play equipment',
    'opening hours',
    'toilets',
    'parking',
  ];
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}. Listed from OpenStreetMap (© OpenStreetMap contributors) only, so whether it is open to the public is unconfirmed too.`;
}

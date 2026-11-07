// Street and place names for new playgrounds, read from the monthly OpenStreetMap snapshot instead of asking
// OpenStreetMap's geocoder (Nominatim) once per playground, which allows only one request a second.
//
// The snapshot (scripts/osm-snapshot.mjs) stores, for each playground, the nearest named street within ROAD_M ("road"),
// and keeps a list of named places (osm-places.json.gz: cities, towns, villages, suburbs, neighbourhoods and hamlets).
// placeNames() works out the suburb and town from that list here, at import time, so the rules can be tuned without
// rebuilding the snapshot. scripts/osm-names-check.mjs compares both with the names already on the site.
//
// addressFor() is what the import jobs call (scripts/find-gaps.mjs, scripts/junction-gaps.mjs): snapshot names when it
// has them, otherwise one Nominatim lookup as before. It returns { road, sub, town } in Nominatim's sense.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export const ROAD_M = 250;
// Streets Nominatim would give as the "road", "pedestrian" or "footway" of an address. Motorways are left out (no one
// names a playground after one); scripts drop A-road numbers and bypasses as before.
export const ROAD_KINDS = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'pedestrian', 'footway']);
// How far each kind of place reaches, in km, roughly the size of the area it names.
// Tuned against the ~6,000 playgrounds Nominatim named (scripts/osm-names-check.mjs, November 2026).
export const VILLAGE_NEARER = 0.4;
export const PLACE_KM = { suburb: 1.6, quarter: 1.2, neighbourhood: 0.7, village: 1.1, hamlet: 0.8, town: 4, city: 9 };

const R = Math.PI / 180;
/** Metres per degree of longitude and latitude near a latitude. */
const scale = (lat) => [111320 * Math.cos(lat * R), 110574];
const metres = (a, b) => {
  const [mx, my] = scale((a.lat + b.lat) / 2);
  return Math.hypot((a.lng - b.lng) * mx, (a.lat - b.lat) * my);
};

/** Distance in metres from p to the segment a-b ({ lat, lng } each), on a flat map around p. */
export function toSegment(p, a, b) {
  const [mx, my] = scale(p.lat);
  const ax = (a.lng - p.lng) * mx, ay = (a.lat - p.lat) * my, bx = (b.lng - p.lng) * mx, by = (b.lat - p.lat) * my;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Finds each point's nearest named street, fed one street at a time (the whole of Great Britain doesn't fit in memory
 * at once). points: [{ lat, lng }]. add(name, coords) takes a street's name and its line as [[lng, lat], ...].
 * best(i) is the nearest street name within ROAD_M of points[i], or ''.
 */
export function roadFinder(points, maxM = ROAD_M) {
  const CY = 0.004, CX = 0.0065; // about 450 m square in Britain
  const grid = new Map();
  points.forEach((p, i) => {
    const k = `${Math.floor(p.lat / CY)},${Math.floor(p.lng / CX)}`;
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  const found = points.map(() => ({ d: Infinity, name: '' }));
  const pad = maxM / 70000; // degrees, generous in longitude at British latitudes
  return {
    add(name, coords) {
      for (let s = 1; s < coords.length; s++) {
        const a = { lng: coords[s - 1][0], lat: coords[s - 1][1] }, b = { lng: coords[s][0], lat: coords[s][1] };
        const y0 = Math.floor((Math.min(a.lat, b.lat) - pad) / CY), y1 = Math.floor((Math.max(a.lat, b.lat) + pad) / CY);
        const x0 = Math.floor((Math.min(a.lng, b.lng) - pad) / CX), x1 = Math.floor((Math.max(a.lng, b.lng) + pad) / CX);
        if ((y1 - y0 + 1) * (x1 - x0 + 1) > 400) continue; // a broken line many km long
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++)
            for (const i of grid.get(`${y},${x}`) ?? []) {
              const d = toSegment(points[i], a, b);
              if (d <= maxM && d < found[i].d) found[i] = { d, name };
            }
      }
    },
    best: (i) => found[i].name,
  };
}

/**
 * A grid of named places ([{ n: name, k: kind, lat, lng }]) for placeNames(), with the outlines of mapped places and
 * civil parishes (areas: [{ n, k, bb: [west, south, east, north], r: [[lng, lat, lng, lat, ...], ...] }], from
 * osm-areas.json.gz) on its "areas" property when there are any.
 */
export function placeIndex(places, areas = []) {
  const grid = new Map();
  for (const p of places) {
    const k = `${Math.floor(p.lat / 0.1)},${Math.floor(p.lng / 0.15)}`;
    grid.set(k, [...(grid.get(k) ?? []), p]);
  }
  grid.areas = new Map();
  for (const a of areas) {
    const [w, s, e, n] = a.bb;
    for (let y = Math.floor(s / 0.1); y <= Math.floor(n / 0.1); y++)
      for (let x = Math.floor(w / 0.15); x <= Math.floor(e / 0.15); x++) grid.areas.set(`${y},${x}`, [...(grid.areas.get(`${y},${x}`) ?? []), a]);
  }
  return grid;
}

/** Whether a point is inside an outline (even-odd over all its rings, so holes and separate parts both work). */
export function inside(p, a) {
  const [w, s, e, n] = a.bb;
  if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) return false;
  let c = false;
  for (const r of a.r)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) c = !c;
    }
  return c;
}

/** The outlines a point is inside, smallest first. */
export function areasAt(index, p) {
  const here = index.areas?.get(`${Math.floor(p.lat / 0.1)},${Math.floor(p.lng / 0.15)}`) ?? [];
  return here.filter((a) => inside(p, a)).sort((m, n) => areaOf(m) - areaOf(n));
}
const areaOf = (a) => (a.bb[2] - a.bb[0]) * (a.bb[3] - a.bb[1]);

// Within a parish, places are looked for only inside it, and further out: Nominatim keeps an address's places inside
// the boundary it's in, which is how it knows Birchwood Playground is in Birchwood, Hatfield, though Stanborough's
// point is nearer.
export const PARISH_REACH = Number(process.env.PARISH_REACH ?? 1.6);
const SUBS = ['suburb', 'quarter', 'village', 'neighbourhood', 'hamlet'];

/**
 * The suburb (or village, neighbourhood or hamlet) and the town (or city, or village) a point is in, the way
 * Nominatim's address gives them. A mapped outline the point is inside wins: a suburb or village outline for "sub", a
 * town or city outline for "town". Otherwise places' points are used: "sub" is the first of suburb, village,
 * neighbourhood and hamlet that reaches it, and "town" the town or city that reaches it most strongly, or the village
 * when that's nearer. Inside a civil parish only places in that parish count, and the parish's own name is the town
 * when no town reaches. pc (the point's postcodes.io details, optional) settles two more boundary cases: anywhere in
 * London is "Greater London", and a city council's own area (Liverpool, Sheffield, Birmingham) takes the city's name.
 */
export function placeNames(index, p, pc = null) {
  const within = areasAt(index, p);
  const parish = within.find((a) => a.k === 'parish');
  const areaSub = within.find((a) => SUBS.includes(a.k));
  const areaTown = within.find((a) => a.k === 'town' || a.k === 'city');
  const near = [];
  const y = Math.floor(p.lat / 0.1), x = Math.floor(p.lng / 0.15);
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of index.get(`${y + a},${x + b}`) ?? []) {
        const d = metres(p, q) / 1000;
        const reach = (PLACE_KM[q.k] ?? 0) * (parish ? PARISH_REACH : 1);
        if (reach && d <= reach && (!parish || inside(q, parish))) near.push({ q, d, w: d / reach });
        else if (q.k === 'city' && pc?.admin_district && q.n === pc.admin_district) near.push({ q, d, w: 0, own: true });
      }
  // Towns and cities reach beyond their parish (a town's point may sit in a neighbouring unparished area).
  if (parish)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const q of index.get(`${y + a},${x + b}`) ?? []) {
          if ((q.k !== 'town' && q.k !== 'city') || near.some((c) => c.q === q)) continue;
          const d = metres(p, q) / 1000;
          if (d <= PLACE_KM[q.k]) near.push({ q, d, w: d / PLACE_KM[q.k], outside: true });
        }
  const nearest = (...kinds) => near.filter((c) => kinds.includes(c.q.k) && !c.own && !c.outside).sort((m, n) => m.d - n.d)[0];
  let subHit = nearest('suburb', 'quarter') ?? nearest('village') ?? nearest('neighbourhood') ?? nearest('hamlet');
  // A village right beside the point beats a suburb further off (Lemsford's playground, not Hatfield Garden Village's).
  const closeVillage = nearest('village');
  if (subHit && closeVillage && subHit.q.k !== 'village' && closeVillage.d < subHit.d * VILLAGE_NEARER) subHit = closeVillage;
  const own = near.find((c) => c.own);
  let townHit = own ?? near.filter((c) => c.q.k === 'town' || c.q.k === 'city').sort((m, n) => (m.outside - n.outside) || m.w - n.w)[0];
  // A village nearer than any town is its own place, not part of the town (Nominatim: town ?? city ?? village).
  const village = nearest('village');
  // Not when the point is in a suburb, which belongs to a town (Haldens is Welwyn Garden City, not nearby Digswell).
  const sub = areaSub?.n ?? subHit?.q.n ?? '';
  const subKind = areaSub?.k ?? subHit?.q.k;
  const inSuburb = ['suburb', 'quarter'].includes(subKind);
  if (!own && !inSuburb && village && (!townHit || village.d < townHit.d)) townHit = village;
  let town = own?.q.n ?? areaTown?.n ?? townHit?.q.n ?? '';
  if (!own && !areaTown && parish && (!townHit || townHit.outside)) town = PARISH_TOWN ? parish.n : town;
  if (!town && subKind === 'village') town = sub;
  if (pc?.region === 'London') town = 'Greater London';
  return { sub, town };
}
export const PARISH_TOWN = (process.env.PARISH_TOWN ?? '1') === '1';

/**
 * An outline ring ([[lng, lat], ...]) simplified to within tol degrees (Douglas-Peucker) and flattened to
 * [lng, lat, lng, lat, ...] rounded to 5 decimal places, for osm-areas.json.gz. Rings that shrink below a triangle
 * come back empty.
 */
export function simplifyRing(ring, tol = 0.0002) {
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, at = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > max) (max = d), (at = i);
    }
    if (max > tol) (keep[at] = 1), stack.push([a, at], [at, b]);
  }
  const out = [];
  ring.forEach(([x, y], i) => keep[i] && out.push(Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5));
  return out.length >= 8 ? out : [];
}

/** Reads a JSON file, gzipped or not. */
export async function loadJson(file) {
  const raw = await readFile(file);
  return JSON.parse((raw[0] === 0x1f ? gunzipSync(raw) : raw).toString());
}

const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; names new playgrounds)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Names for writing new playground files. snapshot: the playgrounds in the snapshot (OSM_PLAYGROUNDS); places: the
 * named places (OSM_PLACES); areas: the outlines of places and parishes (OSM_AREAS). All are optional: without the new snapshot format, every lookup goes to Nominatim.
 * address(p, osmId, pc) (pc: the point's postcodes.io details, optional) returns { road, sub, town, from: 'snapshot' | 'nominatim' }.
 */
export function addressFor(snapshot = [], places = null, areas = []) {
  const byId = new Map(snapshot.map((p) => [p.id, p]));
  const index = places ? placeIndex(places, areas) : null;
  let last = 0;
  const counts = { snapshot: 0, nominatim: 0 };
  const address = async (p, osmId, pc = null) => {
    const s = osmId ? byId.get(osmId) : null;
    if (index && s) {
      counts.snapshot++;
      return { road: s.road ?? '', ...placeNames(index, s, pc), from: 'snapshot' };
    }
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    counts.nominatim++;
    const a = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&addressdetails=1&lat=${p.lat}&lon=${p.lng}`, { headers: UA })
      .then((r) => r.json()).then((j) => j.address ?? {}).catch(() => ({}));
    return {
      road: a.road ?? a.pedestrian ?? a.footway ?? '',
      sub: a.suburb ?? a.village ?? a.neighbourhood ?? a.hamlet ?? '',
      town: a.town ?? a.city ?? a.village ?? '',
      from: 'nominatim',
    };
  };
  address.counts = counts;
  return address;
}

/** The snapshot names for the import jobs, from the files the osm-snapshot action unpacked (empty when absent). */
export async function snapshotNames() {
  const snapshot = process.env.OSM_PLAYGROUNDS ? await loadJson(process.env.OSM_PLAYGROUNDS).catch(() => []) : [];
  const places = process.env.OSM_PLACES ? await loadJson(process.env.OSM_PLACES).catch(() => null) : null;
  const areas = process.env.OSM_AREAS ? await loadJson(process.env.OSM_AREAS).catch(() => []) : [];
  return addressFor(snapshot, places, areas);
}

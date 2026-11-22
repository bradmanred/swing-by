// Builds the OpenStreetMap snapshot that other jobs use instead of asking the busy Overpass servers.
//
// Input: GeoJSON sequences made by osmium (see .github/workflows/osm-snapshot.yml) from Geofabrik's daily extracts
// of Great Britain and of Ireland and Northern Ireland: playgrounds, parks and similar open spaces; and optionally
// named streets (--roads) and named places (--places), for naming new playgrounds without asking Nominatim
// (scripts/osm-names.mjs).
// Output, in the folder given:
//   osm-playgrounds.json.gz  every leisure=playground: [{ id: 'way/123', lat, lng, tags, road, park, equip, within }],
//                            the format check-positions.mjs and junction-gaps.mjs read with --osm-file. "road" is the
//                            nearest named street within 250 m, when --roads was given and there is one; "park" the
//                            smallest named park, garden, common, recreation ground or nature reserve it is inside;
//                            "equip" the equipment codes of the swings, slides and so on mapped inside it (playground=*
//                            points); "within" 'school', 'pub', 'hotel' or 'holiday park' when it is inside such grounds
//                            (scripts/osm-details.mjs). Each is left out when there's nothing to say.
//   osm-parks.json.gz        parks, gardens, commons, recreation grounds and nature reserves with a name, for finding
//                            a council's park by name: [{ id, lat, lng, name, kind }]
//   osm-places.json.gz       with --places: named cities, towns, villages, suburbs, neighbourhoods and hamlets,
//                            [{ n: name, k: kind, lat, lng }]
//   osm-areas.json.gz        with --areas: outlines of mapped places and civil parishes,
//                            [{ n: name, k: kind or 'parish', bb: [west, south, east, north], r: [[lng, lat, ...], ...] }]
//   meta.json                { date, playgrounds, parks, places, areas, named, source }
// A point stands for each feature: the node itself, or the middle of a way or area's outline.
//
//   node scripts/osm-snapshot.mjs out-folder play1.geojsonseq [...] [--roads roads1.geojsonseq ...] [--places places1.geojsonseq ...] [--areas areas1.geojsonseq ...]
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { PLACE_KM, ROAD_KINDS, areasAt, placeIndex, roadFinder, simplifyRing } from './osm-names.mjs';
import { PARK_KINDS, equipmentCode, groundsKind, sortCodes } from './osm-details.mjs';

const [out, ...rest] = process.argv.slice(2);
const inputs = { play: [], roads: [], places: [], areas: [] };
let into = 'play';
for (const a of rest) {
  if (a === '--roads' || a === '--places' || a === '--areas') into = a.slice(2);
  else inputs[into].push(a);
}
if (!out || !inputs.play.length) throw new Error('Usage: node scripts/osm-snapshot.mjs out-folder play.geojsonseq ... [--roads roads.geojsonseq ...] [--places places.geojsonseq ...]');
const KEEP = ['name', 'access', 'operator', 'indoor', 'leisure', 'landuse', 'playground', 'min_age', 'max_age', 'wheelchair', 'fee'];
const round = (n) => Math.round(n * 1e5) / 1e5;

/** The middle of a feature: the average of its outline's points (good enough to pin a playground or find a park). */
function middle(g) {
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(g.coordinates);
  if (!pts.length) return null;
  const [x, y] = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return { lng: round(x / pts.length), lat: round(y / pts.length) };
}

/** A feature's outline for areasAt(): { bb, r }, simplified by tol degrees (0 keeps every point), or null for a point or line. */
function outline(g, tol) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const flat = (ring) => ring.flatMap(([x, y]) => [round(x), round(y)]);
  // A ring too small to simplify (a small playground or school) keeps every point.
  const r = polys.flat().map((ring) => {
    const simple = tol ? simplifyRing(ring, tol) : [];
    return simple.length ? simple : flat(ring);
  }).filter((ring) => ring.length >= 8);
  if (!r.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of r)
    for (let i = 0; i < ring.length; i += 2) (w = Math.min(w, ring[i])), (e = Math.max(e, ring[i])), (s = Math.min(s, ring[i + 1])), (n = Math.max(n, ring[i + 1]));
  return { bb: [w, s, e, n], r };
}

/** Points on a grid of about 100 m squares, with nearest(p, metres). */
function pointGrid(points) {
  const key = (lat, lng) => `${Math.floor(lat * 1000)},${Math.floor(lng * 600)}`;
  const grid = new Map();
  for (const q of points) grid.set(key(q.lat, q.lng), [...(grid.get(key(q.lat, q.lng)) ?? []), q]);
  const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111200, (a.lng - b.lng) * 111200 * Math.cos((a.lat * Math.PI) / 180));
  return {
    nearest(p, max) {
      let best = null, bd = max;
      const [y, x] = [Math.floor(p.lat * 1000), Math.floor(p.lng * 600)];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
        for (const q of grid.get(`${y + a},${x + b}`) ?? []) {
          const d = metres(p, q);
          if (d <= bd) (best = q), (bd = d);
        }
      return best;
    },
  };
}

/** Each feature in GeoJSON sequence files, one at a time. */
async function* features(files) {
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const raw of lines) {
      const line = raw.replace(/^\x1e/, '').trim(); // GeoJSON sequences may start each record with a record separator
      if (!line) continue;
      try {
        const f = JSON.parse(line);
        if (f.geometry) yield f;
      } catch {
        // a damaged line: skip it
      }
    }
  }
}

const playgrounds = new Map();
const parks = new Map();
const parkOutlines = []; // named open spaces, for naming the playgrounds inside them
const grounds = []; // schools, pubs, hotels and holiday parks, whose playgrounds aren't public
const playOutlines = []; // playgrounds mapped as areas, for the equipment inside them
const equipment = []; // swings, slides and so on: [{ lat, lng, code }]
for await (const f of features(inputs.play)) {
  const p = f.properties ?? {};
  const type = p['@type'];
  const id = p['@id'];
  if (!type || id == null) continue;
  const key = `${type}/${id}`;
  const g = f.geometry;
  const kind = p.leisure === 'playground' ? 'play' : PARK_KINDS.has(p.leisure) || p.landuse === 'recreation_ground' ? 'park' : null;
  if (!kind) {
    // Not a playground or a park: grounds whose playgrounds are left out, or a piece of play equipment.
    const gk = groundsKind(p);
    if (gk) {
      const o = outline(g, 0.00005);
      if (o) grounds.push({ ...o, n: gk });
    } else if (g.type === 'Point') {
      const code = equipmentCode(p);
      if (code) equipment.push({ lng: g.coordinates[0], lat: g.coordinates[1], code });
    }
    continue;
  }
  const at = middle(g);
  if (!at) continue;
  const tags = Object.fromEntries(KEEP.filter((k) => p[k] != null).map((k) => [k, String(p[k])]));
  if (kind === 'play') {
    playgrounds.set(key, { id: key, ...at, tags });
    const o = outline(g, 0);
    if (o) playOutlines.push({ ...o, n: key });
  } else if (p.name) {
    parks.set(key, { id: key, ...at, name: String(p.name), kind: p.leisure ?? p.landuse ?? '' });
    const o = outline(g, 0.00005);
    if (o) parkOutlines.push({ ...o, n: String(p.name) });
  }
}

// The park each playground is in, whose grounds it's in, and the equipment mapped inside it.
const parkIndex = placeIndex([], parkOutlines);
const groundsIndex = placeIndex([], grounds);
const playIndex = placeIndex([], playOutlines);
for (const pg of playgrounds.values()) {
  const park = areasAt(parkIndex, pg)[0];
  if (park && park.n !== pg.tags.name) pg.park = park.n;
  const within = areasAt(groundsIndex, pg)[0];
  if (within) pg.within = within.n;
}
// Equipment mapped as points: inside a playground's outline, or else within 30 m of a playground mapped as a point.
const pointPlay = pointGrid([...playgrounds.values()].filter((pg) => pg.id.startsWith('node/')));
let equipped = 0;
for (const e of equipment) {
  const into = areasAt(playIndex, e)[0]?.n ?? pointPlay.nearest(e, 30)?.id;
  const pg = into && playgrounds.get(into);
  if (pg) (pg.equip ??= []).push(e.code);
}
for (const pg of playgrounds.values()) if (pg.equip) (pg.equip = sortCodes(pg.equip)), equipped++;

// Nearest named street to each playground, streamed street by street.
const list = [...playgrounds.values()];
let named = 0;
if (inputs.roads.length) {
  const finder = roadFinder(list);
  for await (const f of features(inputs.roads)) {
    const p = f.properties ?? {};
    if (!p.name || !ROAD_KINDS.has(p.highway)) continue;
    const g = f.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : [];
    for (const line of lines) finder.add(String(p.name), line);
  }
  list.forEach((pg, i) => {
    const road = finder.best(i);
    if (road) (pg.road = road), named++;
  });
}

// Named places.
const places = [];
for await (const f of features(inputs.places)) {
  const p = f.properties ?? {};
  if (!p.name || !PLACE_KM[p.place] || f.geometry.type !== 'Point') continue;
  const [lng, lat] = f.geometry.coordinates;
  places.push({ n: String(p.name), k: p.place, lat: round(lat), lng: round(lng) });
}

// Outlines of mapped places and civil parishes (admin_level 10), simplified to about 20 m, so imports can tell which
// suburb, village or parish a playground is inside, as Nominatim does.
const areas = [];
// Ireland's admin_level 10 is townlands (tens of thousands of them, field-sized), not parishes, so those are skipped.
for (const file of inputs.areas) for await (const f of features([file])) {
  if (/ireland/.test(file) && f.properties?.boundary) continue;
  const p = f.properties ?? {};
  const kind = PLACE_KM[p.place] ? p.place : p.boundary === 'administrative' && String(p.admin_level) === '10' ? 'parish' : null;
  if (!p.name || !kind) continue;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const r = polys.flat().map((ring) => simplifyRing(ring)).filter((ring) => ring.length);
  if (!r.length) continue;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of r)
    for (let i = 0; i < ring.length; i += 2) (w = Math.min(w, ring[i])), (e = Math.max(e, ring[i])), (s = Math.min(s, ring[i + 1])), (n = Math.max(n, ring[i + 1]));
  areas.push({ n: String(p.name), k: kind, bb: [w, s, e, n], r });
}

await mkdir(out, { recursive: true });
if (inputs.areas.length) await writeFile(join(out, 'osm-areas.json.gz'), gzipSync(JSON.stringify(areas)));
await writeFile(join(out, 'osm-playgrounds.json.gz'), gzipSync(JSON.stringify(list)));
await writeFile(join(out, 'osm-parks.json.gz'), gzipSync(JSON.stringify([...parks.values()])));
if (inputs.places.length) await writeFile(join(out, 'osm-places.json.gz'), gzipSync(JSON.stringify(places)));
const meta = {
  date: new Date().toISOString().slice(0, 10), playgrounds: playgrounds.size, parks: parks.size,
  inParks: list.filter((pg) => pg.park).length, equipped, withinGrounds: list.filter((pg) => pg.within).length,
  ...(inputs.roads.length && { named }), ...(inputs.places.length && { places: places.length }), ...(inputs.areas.length && { areas: areas.length }),
  source: 'Geofabrik extracts of OpenStreetMap (© OpenStreetMap contributors, ODbL)',
};
await writeFile(join(out, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`${meta.playgrounds} playgrounds (${named} with a street name within 250 m, ${meta.inParks} in a named park, ${equipped} with equipment mapped, ${meta.withinGrounds} inside school, pub, hotel or holiday park grounds), ${meta.parks} named parks and open spaces, ${places.length} named places, ${areas.length} place and parish outlines`);

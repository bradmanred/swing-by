// Checks how much of the country Swing By covers, council sources first.
//
// For each county, biggest population first, it compares the playgrounds mapped on OpenStreetMap with the
// ones we list and works out which council (local authority) each missing one is in. Then:
//   1. Councils with a machine-readable list in src/data/council-sources.json ("feed") are read first, and any
//      playground on the council's own list that we don't have is added as verified, with the council as source.
//   2. Only in councils whose own lists have already been checked (listed in council-sources.json) are the
//      remaining gaps filled from OpenStreetMap, as Unverified.
//   3. Everywhere else, the report lists the council as "check the council's own list first", with how many
//      playgrounds are missing, so a person (or Claude) can work through docs/finding-playgrounds.md for it.
//
//   node scripts/find-gaps.mjs                        report only (reports/coverage.md and reports/gaps.json)
//   node scripts/find-gaps.mjs --add 150              add up to 150 playgrounds, council-listed ones first
//   node scripts/find-gaps.mjs --only "Kent" --add 50
//   node scripts/find-gaps.mjs --osm-fallback --add 50   also fill gaps from OpenStreetMap in councils not yet checked
//   node scripts/find-gaps.mjs --limit 5              only the first 5 counties (for a quick test)
//
// With SCAN_MINUTES set, it stops starting new counties after that many minutes and carries on with what it has.
// The county to start from next time is kept in .coverage-progress.json (the workflow keeps that file between runs),
// so over a few months every county is reached, biggest first each time round.
//
// Playgrounds from OpenStreetMap follow docs/finding-playgrounds.md: Unverified (no "checked" date), the
// OpenStreetMap page as the source, and the OpenStreetMap credit. Ones tagged private or indoor, or at schools,
// pubs, hotels and holiday parks (by name, or inside their grounds), are left out, as are ones within 150 m of a
// playground we list. Each is named after the park it's in when it has no name of its own, with the equipment, ages
// and step-free access mapped on OpenStreetMap (scripts/osm-details.mjs).
// OpenStreetMap's playgrounds come from the monthly snapshot (.github/actions/osm-snapshot) when there is a recent one,
// and from Overpass only when there isn't; new playgrounds are named from it too (scripts/osm-names.mjs).
// Run by .github/workflows/coverage.yml.
import { countyOf } from './counties.mjs';
import { SAME_M, ROUGH_M, namesAgree, osmIds, roughPin, samePlace } from './same-place.mjs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFeed } from './council-feeds.mjs';
import { snapshotNames } from './osm-names.mjs';
import { isPublic, isPublicPlay, osmPlaygroundDoc } from './osm-details.mjs';

const DIR = 'src/content/playgrounds';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; finds playgrounds missing from the site)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const ADD = Number(arg('--add', 0)) || 0;
// One county, or several separated by commas ("Norfolk, Suffolk, Cambridgeshire").
const ONLY = arg('--only', '');
const ONLY_SET = new Set(ONLY.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
const LIMIT = Number(arg('--limit', 0)) || Infinity;
const OSM_FALLBACK = process.argv.includes('--osm-fallback');
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ceremonial counties of England, and Wales, Scotland and Northern Ireland as a whole, with their
// approximate populations (thousands, 2021 and 2022 censuses), so the biggest are checked first.
const AREAS = [
  ['Greater London', 8866], ['Scotland', 5440, 'GB-SCT'], ['Wales', 3108, 'GB-WLS'], ['West Midlands', 2920], ['Greater Manchester', 2868],
  ['West Yorkshire', 2352], ['Northern Ireland', 1904, 'GB-NIR'], ['Kent', 1847], ['Hampshire', 1845], ['Essex', 1833], ['Lancashire', 1532],
  ['Merseyside', 1424], ['South Yorkshire', 1377], ['Surrey', 1203], ['Hertfordshire', 1198], ['Devon', 1195], ['North Yorkshire', 1158],
  ['Nottinghamshire', 1155], ['Staffordshire', 1131], ['Tyne and Wear', 1126], ['Leicestershire', 1095], ['Lincolnshire', 1088],
  ['Cheshire', 1077], ['Derbyshire', 1054], ['Somerset', 966], ['Norfolk', 917], ['Berkshire', 917], ['Gloucestershire', 916],
  ['Cambridgeshire', 897], ['West Sussex', 882], ['Durham', 866], ['East Sussex', 846], ['Buckinghamshire', 809], ['Northamptonshire', 786],
  ['Dorset', 776], ['Suffolk', 761], ['Oxfordshire', 726], ['Wiltshire', 720], ['Bedfordshire', 712], ['Worcestershire', 604],
  ['East Riding of Yorkshire', 600], ['Warwickshire', 597], ['Cornwall', 571], ['Shropshire', 507], ['Cumbria', 500], ['Bristol', 472],
  ['Northumberland', 320], ['Herefordshire', 187], ['Isle of Wight', 140], ['Rutland', 41],
].map(([name, pop, iso]) => ({ name, pop, iso }));

const councils = JSON.parse(await readFile('src/data/council-sources.json', 'utf8')).councils;
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/\b(city of|county of|borough of|council|district|borough|metropolitan|city|county|royal)\b/g, '').replace(/[^a-z]+/g, ' ').trim();
// District, borough and unitary councils. Town and parish councils are entries with a "parish" (its name as postcodes.io
// gives it, such as "Knaresborough"): their feeds are read with their district's, and they drop off the list of town and
// parish councils still to check.
const councilFor = (district) => councils.find((c) => !c.parish && norm(c.district) === norm(district));
const parishFor = (district, parish) => councils.find((c) => c.parish && norm(c.district) === norm(district) && norm(c.parish) === norm(parish));
// postcodes.io's parish for a point, or '' for an unparished area (no town or parish council to check).
const parishOf = (pc) => (pc?.parish && !/unparished/i.test(pc.parish) ? pc.parish : '');

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function overpass(query) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: 'POST', headers: UA, body: new URLSearchParams({ data: query }) });
      if (r.ok) return (await r.json()).elements;
      console.log(`  Overpass answered ${r.status}, trying again`);
    } catch (e) {
      console.log(`  Overpass failed (${e.message}), trying again`);
    }
    await sleep(20000);
  }
  return null;
}

/** Postcodes.io details (district, region, country) for each point, 100 at a time. */
async function lookup(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    let res = null;
    for (let t = 0; t < 3 && !res; t++) {
      res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 2000, limit: 1 })) }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!res) await sleep(5000);
    }
    out.push(...(res?.result ?? chunk.map(() => null)).map((x) => x?.result?.[0] ?? null));
  }
  return out;
}


// Everything we list, on a coarse grid so "is there one within 150 m" is quick. osmOnly marks listings that come from
// OpenStreetMap alone (Unverified), which a council's own record of the same place replaces. rough marks listings whose
// pin is only approximate (from a postcode, street or park's middle), which count as covering a mapped playground up to
// 300 m away when the names agree (scripts/same-place.mjs).
const grid = new Map();
const cellKey = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 60)}`;
const remember = (p) => grid.set(cellKey(p.lat, p.lng), [...(grid.get(cellKey(p.lat, p.lng)) ?? []), p]);
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const osmOnly = !d.checked && (d.sources ?? []).length > 0 && d.sources.every((x) => /openstreetmap\.org\//.test(x.url));
  remember({ id: f.replace(/\.json$/, ''), lat: d.lat, lng: d.lng, osmOnly, name: d.name, osm: osmIds(d.sources), rough: roughPin(d.notConfirmed) });
}
/**
 * The listing nearest p within 150 m, or within 300 m if its pin is rough and the names agree (the grid's own entry,
 * so changes to it stick), or null. p is a mapped playground ({ lat, lng, tags }).
 */
const nearestListed = (p) => {
  let best = null;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of grid.get(`${Math.floor(p.lat * 100) + a},${Math.floor(p.lng * 60) + b}`) ?? []) {
        const d = km(p, q) * 1000;
        const covers = d < SAME_M || (q.rough && d < ROUGH_M && namesAgree(p.tags?.name ?? p.name, q.name) && roughMatch(q, p));
        if (covers && (!best || d < best.d)) best = { q, d };
      }
  return best?.q ?? null;
};
const listed = (p) => !!nearestListed(p);
/**
 * A rough pin stands for one playground, so it only covers one mapped playground beyond 150 m: the nearest public one
 * in the snapshot whose name agrees. (Several unnamed playgrounds can be within 300 m of a park's postcode pin.)
 * Without the snapshot, the first one asked about claims it.
 */
function roughMatch(q, p) {
  if (q.match === undefined) {
    q.match = null;
    let best = Infinity;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const s of snapGrid.get(`${Math.floor(q.lat * 100) + a},${Math.floor(q.lng * 60) + b}`) ?? []) {
          const d = km(q, s) * 1000;
          if (d < ROUGH_M && d < best && isPublicPlay(s) && namesAgree(s.tags?.name, q.name)) [best, q.match] = [d, s.id];
        }
    if (!SNAP.length) q.match = p.id;
  }
  return q.match === p.id;
}
/** For a council record: the listing within 150 m that is the same place (see scripts/same-place.mjs), or null. */
const sameListed = (rec, at = rec) => {
  const near = [];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of grid.get(`${Math.floor(at.lat * 100) + a},${Math.floor(at.lng * 60) + b}`) ?? []) near.push({ q, d: km(at, q) * 1000 });
  near.sort((x, y) => x.d - y.d);
  return near.find(({ q, d }) => samePlace(rec, q, d))?.q ?? null;
};

// The saved OpenStreetMap snapshot (.github/actions/osm-snapshot sets OSM_PLAYGROUNDS), for moving a council's map
// point onto the play area itself. Without it, council points are used as given.
const SNAP = process.env.OSM_PLAYGROUNDS ? JSON.parse(await readFile(process.env.OSM_PLAYGROUNDS, 'utf8')) : [];
const snapGrid = new Map();
for (const p of SNAP) {
  const k = cellKey(p.lat, p.lng);
  snapGrid.set(k, [...(snapGrid.get(k) ?? []), p]);
}
const usedOsm = new Set();
const address = await snapshotNames();
const NAME_SKIP = new Set('play area areas playground playgrounds park parks the and of gardens garden recreation ground open space common green field fields playing children childrens'.split(' '));
const nameWords = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !NAME_SKIP.has(w));
/**
 * Moves a council record onto the OpenStreetMap playground it describes: one sharing a word of its name, else the
 * nearest, within 400 m of a park's point or postcode (60 m of a point the council gives for the play area itself).
 * Returns how it was placed: 'osm', or the record's own 'map' / 'postcode'.
 */
function snap(rec, approximate) {
  const r = approximate || ['postcode', 'park', 'street'].includes(rec.from) ? 400 : 60;
  const ours = new Set(nameWords(rec.name));
  const cands = [];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of snapGrid.get(`${Math.floor(rec.lat * 100) + a},${Math.floor(rec.lng * 60) + b}`) ?? []) {
        if (usedOsm.has(q.id) || !isPublicPlay(q)) continue;
        const d = km(rec, q) * 1000;
        if (d <= r) cands.push({ q, d, strong: nameWords(`${q.tags?.name ?? ''}`).some((w) => ours.has(w)) });
      }
  cands.sort((x, y) => x.d - y.d);
  const pick = cands.find((c) => c.strong) ?? cands[0];
  if (!pick) return rec.from ?? 'map';
  usedOsm.add(pick.q.id);
  Object.assign(rec, { lat: pick.q.lat, lng: pick.q.lng, osm: pick.q.id });
  return 'osm';
}

// The snapshot's public playgrounds in one county, without Overpass. Each ~5 km grid square is first given a county
// from one of its playgrounds (one postcodes.io lookup per square, kept for the whole run), then the playgrounds we
// don't list in that county's squares and their neighbours are looked up one by one, as Overpass's would be. Listed
// ones are counted by their square's county, which is close enough for the coverage figures.
const cellCounty = new Map();
const square = (p) => `${Math.floor(p.lat * 20)},${Math.floor(p.lng * 12)}`;
async function fromSnapshot(name) {
  const pub = SNAP.filter((p) => p.lat != null && isPublicPlay(p));
  const bySquare = new Map();
  for (const p of pub) bySquare.set(square(p), [...(bySquare.get(square(p)) ?? []), p]);
  const todo = [...bySquare.keys()].filter((k) => !cellCounty.has(k));
  const where = await lookup(todo.map((k) => bySquare.get(k)[0]));
  todo.forEach((k, i) => cellCounty.set(k, countyOf(where[i])));
  const near = (k) => {
    const [y, x] = k.split(',').map(Number);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (cellCounty.get(`${y + a},${x + b}`) === name) return true;
    return false;
  };
  const osm = [], missing = [];
  const maybe = [];
  for (const [k, ps] of bySquare) {
    if (!near(k)) continue;
    for (const p of ps) {
      if (listed(p)) {
        if (cellCounty.get(k) === name) osm.push(p);
      } else maybe.push(p);
    }
  }
  const pcs = await lookup(maybe);
  maybe.forEach((p, i) => {
    if (countyOf(pcs[i]) !== name) return;
    p.pc = pcs[i];
    osm.push(p);
    missing.push(p);
  });
  return { osm, missing };
}

// 1. OpenStreetMap, county by county.
const PROGRESS = '.coverage-progress.json';
const SCAN_MS = Number(process.env.SCAN_MINUTES || 0) * 60000;
const started = Date.now();
let startAt = 0;
if (!ONLY && SCAN_MS) startAt = (JSON.parse(await readFile(PROGRESS, 'utf8').catch(() => '{}')).next ?? 0) % AREAS.length;
const ordered = [...AREAS.slice(startAt), ...AREAS.slice(0, startAt)];
const areas = ordered.filter((a) => !ONLY || ONLY_SET.has(a.name.toLowerCase())).slice(0, LIMIT);
const notReached = [];
if (areas.length < ONLY_SET.size || !areas.length) throw new Error(`No county called ${ONLY}. Use one of: ${AREAS.map((a) => a.name).join(', ')}`);
const results = [];
for (const a of areas) {
  if (SCAN_MS && Date.now() - started > SCAN_MS) {
    notReached.push(a.name);
    continue;
  }
  // Ceremonial county where OpenStreetMap has one, otherwise the county council's own boundary (as for Hertfordshire).
  const sel = a.iso
    ? `area["ISO3166-2"="${a.iso}"]`
    : `(area["boundary"="ceremonial"]["name"~"^(County |City of )?${a.name}$"];area["boundary"="administrative"]["admin_level"="6"]["name"~"^(County |City of )?${a.name}$"];)`;
  console.log(`${a.name}…`);
  let osm, missing;
  if (SNAP.length) {
    // The saved monthly snapshot has the same playgrounds as Overpass, without the wait: Overpass is often overloaded,
    // and runs used to spend up to 17 minutes waiting on it before falling back to the snapshot anyway.
    ({ osm, missing } = await fromSnapshot(a.name));
  } else {
    const els = await overpass(`[out:json][timeout:600][maxsize:1073741824];${sel}->.a;nwr[leisure=playground](area.a);out center tags;`);
    if (!els) {
      results.push({ ...a, error: 'OpenStreetMap could not be reached' });
      continue;
    }
    osm = els
      .map((e) => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, tags: e.tags ?? {} }))
      .filter((p) => p.lat != null && isPublic(p.tags));
    missing = osm.filter((p) => !listed(p));
    // Which council each missing playground is in.
    const where = await lookup(missing);
    missing.forEach((p, i) => (p.pc = where[i]));
    await sleep(5000);
  }
  results.push({ ...a, osm: osm.length, covered: osm.length - missing.length, missing });
  console.log(`  ${osm.length} public playgrounds on OpenStreetMap, ${missing.length} not on Swing By`);
}
const done = results.filter((r) => !r.error);

// Gaps per council, in county order, biggest gap first within each county.
const byCouncil = [];
for (const r of done) {
  const groups = new Map();
  for (const p of r.missing) {
    const d = p.pc?.admin_district ?? 'Unknown council';
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }
  for (const [district, ps] of [...groups].sort((x, y) => y[1].length - x[1].length))
    byCouncil.push({ county: r.name, district, missing: ps, council: councilFor(district) });
}

// 2. Council feeds: read the council's own list (scripts/council-feeds.mjs) and add anything on it we don't have, as verified.
const toAdd = []; // { kind: 'council' | 'osm', ... }
const feedReport = [];
if (ADD > 0) {
  const districts = new Set(byCouncil.map((g) => g.district));
  for (const c of councils.filter((c) => c.feed && [...districts].some((d) => norm(d) === norm(c.district)))) {
    if (toAdd.length >= ADD) break;
    const recs = await readFeed(c.feed);
    let fresh = 0, replacing = 0;
    for (const x of recs) {
      if (toAdd.length >= ADD) break;
      const before = { lat: x.lat, lng: x.lng };
      x.placed = snap(x, c.feed.approximate);
      x.rough = x.placed !== 'osm' && (x.placed !== 'map' || !!c.feed.approximate);
      // Already listed: skip it, unless what we list is an OpenStreetMap-only copy, which the council's record replaces.
      const near = sameListed(x) ?? sameListed(x, before);
      if (near && !near.osmOnly) {
        if (x.osm) usedOsm.delete(x.osm);
        continue;
      }
      if (near) {
        x.replaces = near.id;
        // The OpenStreetMap listing's pin is on the play area; a postcode or park pin isn't.
        if (x.rough) Object.assign(x, { lat: near.lat, lng: near.lng, placed: 'osm', osm: x.osm ?? near.osm[0] });
        near.osmOnly = false; // only one council record replaces it
        replacing++;
      }
      fresh++;
      toAdd.push({ kind: 'council', ...x, council: c });
      remember({ id: null, lat: x.lat, lng: x.lng, osmOnly: false, name: x.name, osm: x.osm ? [x.osm] : [], rough: x.placed !== 'osm' && x.rough }); // so OpenStreetMap copies of the same place aren't added too
    }
    feedReport.push(`${c.council}: ${recs.length} on the council's list, ${fresh} new${replacing ? ` (${replacing} replacing OpenStreetMap-only listings)` : ''}`);
  }
  // 3. OpenStreetMap, only where the council's own list has been checked (unless --osm-fallback).
  for (const g of byCouncil) {
    if (!g.council && !OSM_FALLBACK) continue;
    for (const p of g.missing) {
      if (toAdd.length >= ADD) break;
      if (listed(p) || toAdd.some((q) => km(p, q) * 1000 < 60)) continue;
      toAdd.push({ kind: 'osm', ...p, county: g.county });
    }
  }
}

// Write the files.
let added = { council: 0, osm: 0 };
const replaced = []; // [old id, new id]: OpenStreetMap-only listings replaced by the council's record
if (toAdd.length) {
  const existing = new Set(await readdir(DIR));
  const pcs = await lookup(toAdd);
  const REG = { 'North East': 'north-east', 'North West': 'north-west', 'Yorkshire and The Humber': 'yorkshire', 'East Midlands': 'east-midlands', 'West Midlands': 'west-midlands', 'East of England': 'east', London: 'london', 'South East': 'south-east', 'South West': 'south-west' };
  const CTY = { Hertfordshire: 'herts', Essex: 'essex', Derbyshire: 'derbyshire', Devon: 'devon' };
  const DIST = { Derby: 'derbyshire', Plymouth: 'devon', Torbay: 'devon', 'Southend-on-Sea': 'essex', Thurrock: 'essex' };
  const region = (p) => (!p ? null : { Wales: 'wales', Scotland: 'scotland', 'Northern Ireland': 'northern-ireland' }[p.country] ?? CTY[p.admin_county] ?? DIST[p.admin_district] ?? REG[p.region]);
  const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
  for (const [i, p] of toAdd.entries()) {
    const pc = pcs[i];
    const reg = region(pc);
    if (!reg) continue;
    // Street and place names from the snapshot (scripts/osm-names.mjs); Nominatim only for council pins it didn't place.
    const a = await address(p, p.kind === 'osm' ? p.id : p.osm, pc);
    let road = a.road;
    if (BIG_ROAD.test(road)) road = '';
    const sub = a.sub;
    const town = a.town || (pc.admin_district ?? '');
    const place = sub || town;
    const area = [...new Set([sub, town].filter(Boolean))].join(', ') || pc.admin_district;
    let doc;
    if (p.kind === 'council') {
      // Where the pin came from. Approximate ones are looked at by the pin check (check-positions.mjs).
      const position =
        p.placed === 'osm' ? 'Exact position (taken from OpenStreetMap)'
        : p.placed === 'postcode' ? 'Exact position (approximate: mapped from the postcode)'
        : p.placed === 'park' ? "Exact position (approximate: the park's point on OpenStreetMap, not the play area itself)"
        : p.placed === 'street' ? 'Exact position (approximate: the nearest mapped play area to the street the council names)'
        : p.council.feed.approximate ? "Exact position (approximate: the park's point on the council's map, not the play area itself)"
        : "Exact position (from the council's map)";
      const has = (k) => (p[k] ?? []).length > 0;
      const unknown = [
        has('ages') ? null : 'age ranges',
        has('equipment') ? 'the full list of play equipment' : 'play equipment',
        'opening hours',
        (p.facilities ?? []).includes('wc') ? null : 'toilets',
        'parking',
      ].filter(Boolean);
      doc = {
        name: p.name, region: reg, area, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5,
        ages: p.ages ?? [], equipment: p.equipment ?? [], access: p.access ?? [], facilities: p.facilities ?? [], opens: '',
        description: p.description || `A playground on ${p.council.council}'s own list of play areas.`,
        nearby: [], operator: p.council.council,
        sources: [{ label: `${p.council.council}: ${p.name}`, url: p.url }, ...(p.osm ? [{ label: 'OpenStreetMap: play area', url: `https://www.openstreetmap.org/${p.osm}` }] : [])],
        checked: TODAY,
        notConfirmed: `${position}, ${unknown.slice(0, -1).join(', ')} and ${unknown.at(-1)}.`,
        photo: null,
      };
    } else {
      doc = osmPlaygroundDoc(p, { road, place, area, region: reg });
    }
    let id = slug(`${doc.name}-${doc.area}`).slice(0, 60);
    for (let n = 2, base = id; existing.has(`${id}.json`); n++) id = `${base}-${n}`;
    existing.add(`${id}.json`);
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
    added[p.kind]++;
    if (p.replaces) {
      await unlink(join(DIR, `${p.replaces}.json`)).catch(() => {});
      replaced.push([p.replaces, id]);
    }
  }
}

// Keep replaced listings' old addresses working (worker/index.js sends them to the new listing).
if (replaced.length) {
  const w = await readFile('worker/index.js', 'utf8');
  const lines = replaced.map(([a, b]) => `  '${a}': '${b}',`).join('\n');
  await writeFile('worker/index.js', w.replace(/(const MERGED = \{\n)/, `$1${lines}\n`));
}

// Report.
const pct = (r) => (r.osm ? Math.round((100 * r.covered) / r.osm) : 100);
const todo = byCouncil.filter((g) => !g.council && g.district !== 'Unknown council');
const search = (d) => `https://duckduckgo.com/?q=${encodeURIComponent(`${d} council play areas`)}`;
const lines = [
  '# Swing By coverage',
  '',
  `Checked ${TODAY} against playgrounds mapped on OpenStreetMap (© OpenStreetMap contributors). Counties are in order of population. A playground counts as covered if we list one within ${SAME_M} m of it.`,
  '',
  '| County | Population | On OpenStreetMap | Covered | Missing | Coverage |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...results.map((r) => (r.error ? `| ${r.name} | ${r.pop}k | ${r.error} | | | |` : `| ${r.name} | ${r.pop}k | ${r.osm} | ${r.covered} | ${r.missing.length} | ${pct(r)}% |`)),
  '',
  `In all: ${done.reduce((n, r) => n + r.osm, 0)} public playgrounds on OpenStreetMap, ${done.reduce((n, r) => n + r.missing.length, 0)} not yet on Swing By.`,
  '',
  '## Check these councils\' own lists first',
  '',
  'Gaps here are not filled from OpenStreetMap until the council\'s own play area list has been checked (docs/finding-playgrounds.md) and the council added to src/data/council-sources.json. Biggest counties first.',
  '',
  '| County | Council | Missing | Look for its list |',
  '| --- | --- | ---: | --- |',
  ...todo.slice(0, 60).map((g) => `| ${g.county} | ${g.district} | ${g.missing.length} | [search](${search(g.district)}) |`),
  ...(todo.length > 60 ? [``, `…and ${todo.length - 60} more councils.`] : []),
];
// Town and parish councils in districts already checked, with the most playgrounds still missing: their own lists are
// the next to check (docs/finding-playgrounds.md), since the district council's list doesn't cover them.
const parishTodo = [];
for (const g of byCouncil.filter((g) => g.council)) {
  const by = new Map();
  for (const p of g.missing) {
    const name = parishOf(p.pc);
    if (name && !parishFor(g.district, name)) by.set(name, (by.get(name) ?? 0) + 1);
  }
  for (const [parish, n] of by) parishTodo.push({ county: g.county, district: g.district, parish, missing: n });
}
parishTodo.sort((a, b) => b.missing - a.missing);
const parishSearch = (t) => `https://duckduckgo.com/?q=${encodeURIComponent(`${t.parish} town OR parish council play areas`)}`;
if (parishTodo.length)
  lines.push(
    '',
    '## Then their town and parish councils',
    '',
    'In councils already checked, these town and parish councils have the most playgrounds still missing (filled from OpenStreetMap as Unverified meanwhile). Check each one\'s play area or recreation ground pages and add it to src/data/council-sources.json with its "parish", and a feed or list if it has one.',
    '',
    '| County | Council | Town or parish | Missing | Look for its list |',
    '| --- | --- | --- | ---: | --- |',
    ...parishTodo.slice(0, 40).map((t) => `| ${t.county} | ${t.district} | ${t.parish} | ${t.missing} | [search](${parishSearch(t)}) |`),
    ...(parishTodo.length > 40 ? [``, `…and ${parishTodo.length - 40} more.`] : []),
  );
if (feedReport.length) lines.push('', '## Council lists read', '', ...feedReport.map((l) => `- ${l}`));
if (added.council || added.osm)
  lines.push('', `Added ${added.council} playgrounds from council lists (verified${replaced.length ? `, ${replaced.length} of them replacing OpenStreetMap-only listings, whose old addresses now redirect` : ''}) and ${added.osm} from OpenStreetMap (Unverified, in councils whose own lists have been checked${OSM_FALLBACK ? ', plus councils not yet checked' : ''}).`);
else if (ADD > 0) lines.push('', 'Nothing added: no council list had new playgrounds, and the remaining gaps are all in councils whose own lists need checking first.');

if (address.counts.snapshot + address.counts.nominatim)
  lines.push('', `Street and place names: ${address.counts.snapshot} from the OpenStreetMap snapshot, ${address.counts.nominatim} looked up on Nominatim.`);
if (notReached.length) lines.push('', `Not reached this time (the time limit saves Actions minutes; the next run starts here): ${notReached.join(', ')}.`);
if (!ONLY && SCAN_MS) await writeFile(PROGRESS, JSON.stringify({ next: notReached.length ? AREAS.findIndex((a) => a.name === notReached[0]) : 0 }) + '\n');

await mkdir('reports', { recursive: true });
await writeFile('reports/coverage.md', lines.join('\n') + '\n');
await writeFile('reports/gaps.json', JSON.stringify(byCouncil.map((g) => ({ county: g.county, council: g.district, checked: !!g.council, missing: g.missing.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, name: p.tags.name ?? null, parish: parishOf(p.pc) || null, parishChecked: !!parishFor(g.district, parishOf(p.pc)) })) })), null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(lines.join('\n'));

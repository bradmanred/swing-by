// Fills empty motorway and trunk-road junctions: ones with no playground we list within about 5 minutes (3 miles).
//
// Roads are worked in this order: M1, A1, A1(M), A303, M4, M3, then every other road busiest first (the order in
// src/data/junctions.json, from DfT traffic counts). For each empty junction it adds up to three of the nearest
// public playgrounds mapped on OpenStreetMap within 3 miles, following docs/finding-playgrounds.md: Unverified
// (no "checked" date), the OpenStreetMap page as the source and the OpenStreetMap credit. Ones tagged private or
// indoor, or at schools, pubs, hotels and holiday parks, are left out, as are ones within 150 m of one we list.
//
//   node scripts/junction-gaps.mjs                     report only (reports/junction-gaps.md)
//   node scripts/junction-gaps.mjs --add 400           add up to 400 playgrounds, in road order
//   node scripts/junction-gaps.mjs --roads "M6,M5" --add 100
// Run by .github/workflows/junction-gaps.yml.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotNames } from './osm-names.mjs';

const DIR = 'src/content/playgrounds';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; finds playgrounds near motorway junctions)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const FIRST = ['M1', 'A1', 'A1(M)', 'A303', 'M4', 'M3'];
const EMPTY_KM = 4.8; // about 5 minutes' drive, as on the Road trips page
const PER_JUNCTION = 3;
const SAME_M = 150;
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const ADD = Number(arg('--add', 0)) || 0;
const ONLY = arg('--roads', '').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The monthly OpenStreetMap snapshot (see .github/workflows/osm-snapshot.yml), when the workflow has fetched it. The
// playgrounds it suggests are checked against OpenStreetMap live before they're added, in one small query.
const SNAPSHOT = arg('--osm-file', process.env.OSM_PLAYGROUNDS ?? '');
const snapshot = SNAPSHOT ? JSON.parse(await (await import('node:fs/promises')).readFile(SNAPSHOT, 'utf8')) : null;
if (snapshot) console.log(`Using the OpenStreetMap snapshot (${snapshot.length} playgrounds)`);
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

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

const BAD = /school|nursery|academy|primary|college|\bpub\b|inn\b|hotel|caravan|holiday park|soft play|ikea|mcdonald/i;
const isPublic = (t) => !['private', 'no', 'customers'].includes(t.access) && t.indoor !== 'yes' && !BAD.test(`${t.name ?? ''} ${t.operator ?? ''}`);

// Everything we list (and everything this run adds).
const listedPts = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  if (d.lat != null) listedPts.push({ lat: d.lat, lng: d.lng });
}
const near = (p, list, maxKm) => list.some((q) => Math.abs(q.lat - p.lat) < maxKm / 100 && km(p, q) <= maxKm);

const J = JSON.parse(await readFile('src/data/junctions.json', 'utf8'));
const order = (ONLY.length ? ONLY : [...FIRST, ...J.roads.filter((r) => !FIRST.includes(r))]);
const toAdd = [];
const report = [];
const unfilled = [];
for (const road of order) {
  if (ADD && toAdd.length >= ADD) break;
  const gaps = J.junctions.filter((j) => j.road === road && !near(j, listedPts, EMPTY_KM));
  if (!gaps.length) continue;
  if (!ADD) {
    report.push({ road, gaps: gaps.length, filled: 0 });
    continue;
  }
  console.log(`${road}: ${gaps.length} empty junctions`);
  const osm = [];
  if (snapshot) {
    for (const p of snapshot) if (isPublic(p.tags ?? {}) && gaps.some((j) => km(j, p) <= EMPTY_KM)) osm.push({ ...p, tags: p.tags ?? {} });
  } else for (let i = 0; i < gaps.length; i += 25) {
    const parts = gaps.slice(i, i + 25).map((j) => `nwr[leisure=playground](around:${EMPTY_KM * 1000},${j.lat},${j.lng});`).join('');
    const els = await overpass(`[out:json][timeout:180];(${parts});out center tags;`);
    if (!els) { console.log('  OpenStreetMap could not be reached'); continue; }
    for (const e of els) {
      const p = { id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, tags: e.tags ?? {} };
      if (p.lat != null && isPublic(p.tags) && !osm.some((q) => q.id === p.id)) osm.push(p);
    }
    await sleep(3000);
  }
  let filled = 0;
  for (const j of gaps) {
    if (toAdd.length >= ADD) break;
    if (near(j, listedPts, EMPTY_KM)) { filled++; continue; } // filled by a playground added for a neighbouring junction
    const cands = osm
      .map((p) => [p, km(j, p)])
      .filter(([p, d]) => d <= EMPTY_KM && !near(p, listedPts, SAME_M / 1000))
      .sort((a, b) => a[1] - b[1])
      .slice(0, PER_JUNCTION);
    if (!cands.length) { unfilled.push(j); continue; }
    for (const [p] of cands) {
      if (toAdd.length >= ADD) break;
      toAdd.push({ ...p, road, j: j.j || j.name });
      listedPts.push({ lat: p.lat, lng: p.lng });
    }
    filled++;
  }
  report.push({ road, gaps: gaps.length, filled });
}

// Playgrounds suggested by the snapshot: check they're still mapped, and still public, before adding them.
if (snapshot && toAdd.length) {
  const ids = (t) => toAdd.filter((p) => p.id.startsWith(`${t}/`)).map((p) => p.id.split('/')[1]);
  const q = ['node', 'way', 'relation'].filter((t) => ids(t).length).map((t) => `${t}(id:${ids(t).join(',')});`).join('');
  const live = await overpass(`[out:json][timeout:180];(${q});out tags;`);
  if (live) {
    const ok = new Set(live.filter((e) => e.tags?.leisure === 'playground' && isPublic(e.tags)).map((e) => `${e.type}/${e.id}`));
    const before = toAdd.length;
    toAdd.splice(0, toAdd.length, ...toAdd.filter((p) => ok.has(p.id)));
    console.log(`Checked live: ${toAdd.length} of ${before} still mapped and public`);
  } else console.log('Overpass could not be reached to check the snapshot; using it as it is (under five weeks old)');
}

// Write the files (same format as scripts/find-gaps.mjs).
let added = 0;
if (toAdd.length) {
  const existing = new Set(await readdir(DIR));
  const pcs = await lookup(toAdd);
  const address = await snapshotNames();
  const REG = { 'North East': 'north-east', 'North West': 'north-west', 'Yorkshire and The Humber': 'yorkshire', 'East Midlands': 'east-midlands', 'West Midlands': 'west-midlands', 'East of England': 'east', London: 'london', 'South East': 'south-east', 'South West': 'south-west' };
  const CTY = { Hertfordshire: 'herts', Essex: 'essex', Derbyshire: 'derbyshire', Devon: 'devon' };
  const DIST = { Derby: 'derbyshire', Plymouth: 'devon', Torbay: 'devon', 'Southend-on-Sea': 'essex', Thurrock: 'essex' };
  const region = (p) => (!p ? null : { Wales: 'wales', Scotland: 'scotland', 'Northern Ireland': 'northern-ireland' }[p.country] ?? CTY[p.admin_county] ?? DIST[p.admin_district] ?? REG[p.region]);
  const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const GENERIC = /^(play(ground| area| park|park| space)?s?|children'?s play( area)?)$/i;
  const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
  for (const [i, p] of toAdd.entries()) {
    const pc = pcs[i];
    const reg = region(pc);
    if (!reg) continue;
    // Street and place names from the snapshot when it has them (scripts/osm-names.mjs), otherwise Nominatim.
    const a = await address(p, p.id, pc);
    let road = a.road;
    if (BIG_ROAD.test(road)) road = '';
    const sub = a.sub;
    const town = a.town || (pc.admin_district ?? '');
    const place = sub || town;
    const area = [...new Set([sub, town].filter(Boolean))].join(', ') || pc.admin_district;
    const tagName = (p.tags.name ?? '').trim();
    const name = tagName && !GENERIC.test(tagName) ? tagName : road ? `Playground off ${road}` : `${place} Playground`;
    const nearTxt = [road, place].filter(Boolean).join(', ');
    const doc = {
      name, region: reg, area, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5,
      ages: [], equipment: [], access: [], facilities: [], opens: '',
      description: `A playground on OpenStreetMap${nearTxt ? ` near ${nearTxt}` : ''}. No council list we've checked includes it yet, so we can't confirm it's open to everyone or what it has.`,
      nearby: [],
      ...(p.tags.operator ? { operator: p.tags.operator } : {}),
      sources: [{ label: `OpenStreetMap: ${tagName || 'playground'}`, url: `https://www.openstreetmap.org/${p.id}` }],
      checked: null,
      notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges, play equipment, opening hours, toilets and parking. Listed from OpenStreetMap (© OpenStreetMap contributors) only, so whether it is open to the public is unconfirmed too.',
      photo: null,
    };
    let id = slug(`${doc.name}-${doc.area}`).slice(0, 60);
    while (existing.has(`${id}.json`)) id += '-2';
    existing.add(`${id}.json`);
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
    added++;
  }
}

const lines = [
  '# Empty junctions',
  '',
  `Junctions with no playground we list within ${EMPTY_KM} km (about 5 minutes), in road order: ${FIRST.join(', ')}, then the rest busiest first.`,
  '',
  '| Road | Empty junctions | Filled this run |',
  '| --- | ---: | ---: |',
  ...report.map((r) => `| ${r.road} | ${r.gaps} | ${r.filled} |`),
  '',
  ADD ? `Added ${added} playgrounds from OpenStreetMap (Unverified).` : 'Report only.',
  ...(unfilled.length ? ['', `No public playground on OpenStreetMap within 3 miles of ${unfilled.length} junctions: ${unfilled.map((j) => `${j.road} ${j.j || j.name}`).join(', ')}.`] : []),
];
await mkdir('reports', { recursive: true });
await writeFile('reports/junction-gaps.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(lines.join('\n'));

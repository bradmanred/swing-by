// Temporary (removed before merge): places new playgrounds' pins and fills in their neighbourhood.
// tmp/new-pins.json maps each new playground id to where to start looking:
//   { postcode, borough }        the council's postcode
//   { lat, lng, borough }        the park's point on the council's own map
//   { park, borough }            a park name pattern, looked up on OpenStreetMap inside the borough
// Only playgrounds still on the placeholder position (51.51) are placed, so a re-run only does what's left.
// Each pin moves onto a playground mapped on OpenStreetMap: one whose name shares a word with ours, else the nearest
// (within 250 m of a postcode, or 400 m of a park's point). Otherwise it stays on the starting point, marked
// approximate. The neighbourhood ("Hayes, Hillingdon") comes from postcodes.io's ward for the final position.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { readFileSync as require_ } from 'node:fs';

const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; placing playground pins)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const GENERIC = new Set('play area areas playground playgrounds park parks adventure natural the and of garden gardens recreation ground open space common green field fields playing toddler toddlers juniors junior'.split(' '));
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
const centre = (e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon });
async function overpass(q) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: 'POST', headers: UA, body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(400000) });
      if (r.ok) return (await r.json()).elements;
      console.log(`  Overpass ${r.status}, trying another server`);
    } catch (e) {
      console.log(`  Overpass failed (${e.message}), trying another server`);
    }
    await sleep(10000);
  }
  console.log('  OpenStreetMap live servers unreachable; carrying on without them');
  return [];
}
const postJSON = async (url, body) => (await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

// Saved OpenStreetMap snapshot (osm-data branch), downloaded by the workflow into tmp/osm.
const snap = (n) => JSON.parse(gunzipSync(require_(`tmp/osm/osm-${n}.json.gz`)));
const PLAYS = snap('playgrounds');
const PARKS = snap('parks');
console.log(`Snapshot: ${PLAYS.length} playgrounds, ${PARKS.length} parks`);
// Rough boxes for the boroughs whose parks are looked up by name (the snapshot has no borough outlines).
const BOX = {
  'London Borough of Lewisham': [51.405, 51.495, -0.08, 0.045],
  'London Borough of Waltham Forest': [51.55, 51.65, -0.065, 0.035],
  'London Borough of Hounslow': [51.42, 51.505, -0.47, -0.24],
};
const inBox = (b, p) => { const x = BOX[b]; return !x || (p.lat >= x[0] && p.lat <= x[1] && p.lng >= x[2] && p.lng <= x[3]); };
const pcs = JSON.parse(await readFile('tmp/new-pins.json', 'utf8'));
const todo = [];
for (const [id, src] of Object.entries(pcs)) {
  const doc = JSON.parse(await readFile(`src/content/playgrounds/${id}.json`, 'utf8'));
  if (doc.lat === 51.51) todo.push({ id, src, doc });
}
console.log(`${todo.length} pins to place`);
const others = [];
for (const f of await readdir('src/content/playgrounds')) {
  const id = f.replace(/\.json$/, '');
  if (pcs[id]) continue;
  const d = JSON.parse(await readFile(`src/content/playgrounds/${f}`, 'utf8'));
  others.push({ id, lat: d.lat, lng: d.lng });
}

// 1. Starting points.
const postcodes = [...new Set(todo.filter((t) => t.src.postcode && t.src.lat == null).map((t) => t.src.postcode))];
const byPc = {};
for (let i = 0; i < postcodes.length; i += 100) for (const x of (await postJSON('https://api.postcodes.io/postcodes', { postcodes: postcodes.slice(i, i + 100) })).result) byPc[x.query] = x.result;
// { any, borough }: a park or playground of that name in the snapshot, else any named feature (a street, church or pub)
// inside the borough from the live servers in one batched query; then playgrounds within 300 m.
const anyTodo = todo.filter((t) => t.src.any);
for (const t of anyTodo) {
  const re = new RegExp(`^(${t.src.any})$`, 'i');
  const hit = [...PARKS, ...PLAYS.map((p) => ({ ...p, name: p.tags?.name ?? '' }))].find((p) => p.name && re.test(p.name.trim()) && inBox(t.src.borough, p));
  if (hit) Object.assign(t, { at: hit, how: `named ${hit.name} (snapshot)`, r: 300 });
}
const anyLeft = anyTodo.filter((t) => !t.at);
if (anyLeft.length) {
  console.log(`${anyLeft.length} named places to look up live`);
  const b = anyLeft[0].src.borough;
  const els = await overpass(`[out:json][timeout:300];area["name"="${b}"]["boundary"="administrative"]->.a;nwr[name~"^(${anyLeft.map((t) => t.src.any).join('|')})$",i](area.a);out center tags;`);
  for (const t of anyLeft) {
    const re = new RegExp(`^(${t.src.any})$`, 'i');
    const hit = els.map((e) => ({ ...centre(e), name: e.tags?.name ?? '' })).find((e) => e.lat != null && re.test(e.name));
    if (hit) Object.assign(t, { at: hit, how: `named ${hit.name}`, r: 300 });
  }
}
const parksIn = {};
for (const b of new Set(todo.filter((t) => t.src.park).map((t) => t.src.borough))) parksIn[b] = PARKS.filter((p) => inBox(b, p));
for (const t of todo) {
  const s = t.src;
  if (s.lat != null) Object.assign(t, { at: { lat: s.lat, lng: s.lng }, how: 'council map', r: 400 });
  else if (s.postcode) {
    const g = byPc[s.postcode];
    if (g) Object.assign(t, { at: { lat: g.latitude, lng: g.longitude }, how: `postcode ${s.postcode}`, r: 250 });
  } else if (s.park) {
    const re = new RegExp(`^(${s.park})$`, 'i');
    const key = words(s.park.replace(/\\/g, '').split('|')[0])[0];
    const all = parksIn[s.borough].filter((p) => p.lat != null);
    const pk = all.find((p) => re.test(p.name.trim())) ?? (key ? all.find((p) => words(p.name).includes(key)) : null);
    if (pk) Object.assign(t, { at: pk, how: `park ${pk.name}`, r: 400 });
  }
}

// 2. Playgrounds around every starting point.
const placed = todo.filter((t) => t.at);
const play = new Map();
for (const t of placed) for (const p of PLAYS) if (Math.abs(p.lat - t.at.lat) < 0.005 && metres(t.at, p) <= t.r) play.set(p.id, { id: p.id, lat: p.lat, lng: p.lng, t: p.tags ?? {} });
console.log(`${play.size} mapped playgrounds nearby`);

// 3. Choose each pin (closest starting points first, so two playgrounds don't take the same mapped one).
const lines = ['| id | from | result | metres | OpenStreetMap | already listed within 150 m |', '|---|---|---|---|---|---|'];
const used = new Set();
const done = [];
for (const t of todo) {
  if (!t.at) {
    lines.push(`| ${t.id} | ${t.src.postcode ?? t.src.park} | NOT FOUND | | | |`);
    continue;
  }
  const ours = new Set(words(t.doc.name));
  const cands = [...play.values()]
    .filter((c) => !used.has(c.id) && c.t.indoor !== 'yes' && !['private', 'no', 'customers'].includes(c.t.access))
    .map((c) => ({ ...c, d: Math.round(metres(t.at, c)), strong: words(`${c.t.name ?? ''} ${c.t.operator ?? ''}`).some((w) => ours.has(w)) }))
    .filter((c) => c.d <= t.r)
    .sort((a, b) => a.d - b.d);
  const pick = cands.find((c) => c.strong) ?? cands[0];
  const doc = t.doc;
  const to = pick ?? t.at;
  doc.lat = Math.round(to.lat * 1e5) / 1e5;
  doc.lng = Math.round(to.lng * 1e5) / 1e5;
  if (pick) {
    used.add(pick.id);
    doc.notConfirmed = doc.notConfirmed.replace(/Exact position \([^)]*\)/, 'Exact position (taken from OpenStreetMap)');
  } else {
    const what = t.src.lat != null ? "the park's point on the council's map" : t.src.postcode ? 'mapped from the postcode' : 'the middle of the park';
    doc.notConfirmed = doc.notConfirmed.replace(/Exact position \([^)]*\)/, `Exact position (approximate: ${what})`);
  }
  done.push(t);
  const dups = others.filter((o) => metres(o, doc) <= 150).map((o) => `${o.id} (${Math.round(metres(o, doc))}m)`);
  lines.push(`| ${t.id} | ${t.how} | ${pick ? (pick.strong ? 'moved (match)' : 'moved (near)') : 'stays'} | ${pick?.d ?? ''} | ${pick ? `${pick.id} ${pick.t.name ?? 'unnamed'}` : ''} | ${dups.join(', ')} |`);
}

// 4. Neighbourhood from the ward, for playgrounds whose area is just the borough's name.
const needArea = done.filter((t) => !t.doc.area.includes(','));
for (let i = 0; i < needArea.length; i += 100) {
  const chunk = needArea.slice(i, i + 100);
  const res = (await postJSON('https://api.postcodes.io/postcodes', { geolocations: chunk.map((t) => ({ latitude: t.doc.lat, longitude: t.doc.lng, limit: 1, radius: 1000 })) })).result;
  res.forEach((r, k) => {
    const p = r.result?.[0];
    const t = chunk[k];
    if (p?.admin_ward) t.doc.area = `${p.admin_ward.replace(/\s*&\s*/g, ' and ')}, ${t.doc.area}`;
  });
}
for (const t of done) await writeFile(`src/content/playgrounds/${t.id}.json`, JSON.stringify(t.doc, null, 2) + '\n');
await writeFile('tmp/pins-report.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));

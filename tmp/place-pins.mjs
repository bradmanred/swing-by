// Temporary (removed before merge): places new playgrounds' pins.
// tmp/new-pins.json maps each new playground id to a postcode, or to { park, borough } (a park name pattern and the
// borough's OpenStreetMap name) when the council gives no postcode. Only playgrounds still on a placeholder position
// are placed, so a re-run only does what's left.
//
// 1. Starting points: postcodes in one request to postcodes.io; parks in one OpenStreetMap request per borough.
// 2. One OpenStreetMap request for the playgrounds around every starting point.
// 3. Each pin moves onto the nearest mapped playground whose name shares a word with ours (council parks) or, with
//    PIN_MODE=members, one marked customers/permissive or run by the organisation; failing that, the nearest within
//    250 m (postcodes) or inside the park's 400 m; otherwise it stays on the starting point.
import { readdir, readFile, writeFile } from 'node:fs/promises';

const MEMBERS = process.env.PIN_MODE === 'members';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; placing playground pins)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const PLACEHOLDER = new Set([51.53, 51.54, 51.51, 54]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const GENERIC = new Set('play area areas playground playgrounds park parks adventure natural the and of garden gardens castle hall house centre estate wild woodland rhs wwt recreation ground open space'.split(' '));
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
const ORG = { nt: ['national trust'], hh: [], rhs: ['royal horticultural', 'rhs'], wwt: ['wildfowl', 'wetland', 'wwt'], nts: ['national trust for scotland', 'national trust'] };

async function overpass(q) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: 'POST', headers: UA, body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(400000) });
      if (r.ok) return (await r.json()).elements;
      console.log(`  Overpass ${r.status}, trying another server`);
    } catch (e) {
      console.log(`  Overpass failed (${e.message}), trying another server`);
    }
    await sleep(10000);
  }
  throw new Error('OpenStreetMap could not be reached');
}
const centre = (e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon });

const pcs = JSON.parse(await readFile('tmp/new-pins.json', 'utf8'));
const todo = [];
for (const [id, src] of Object.entries(pcs)) {
  const doc = JSON.parse(await readFile(`src/content/playgrounds/${id}.json`, 'utf8'));
  if (PLACEHOLDER.has(doc.lat)) todo.push({ id, src, doc });
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
const postcodes = [...new Set(todo.filter((t) => typeof t.src === 'string').map((t) => t.src))];
const byPc = {};
for (let i = 0; i < postcodes.length; i += 100) {
  const geo = await (await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: postcodes.slice(i, i + 100) }) })).json();
  for (const x of geo.result) byPc[x.query] = x.result;
}
const boroughs = [...new Set(todo.filter((t) => typeof t.src !== 'string').map((t) => t.src.borough))];
const parksIn = {};
for (const b of boroughs) {
  console.log(`Parks in ${b}`);
  parksIn[b] = (await overpass(`[out:json][timeout:180];area["name"="${b}"]["boundary"="administrative"]->.a;nwr[leisure=park](area.a);out center tags;`)).map((e) => ({ ...centre(e), name: e.tags?.name ?? '' }));
}
for (const t of todo) {
  if (typeof t.src === 'string') {
    const g = byPc[t.src];
    if (g) Object.assign(t, { at: { lat: g.latitude, lng: g.longitude }, where: g.admin_district, r: 1500 });
  } else {
    const re = new RegExp(`^(${t.src.park})$`, 'i');
    const pk = parksIn[t.src.borough].find((p) => p.lat != null && re.test(p.name.trim()));
    if (pk) Object.assign(t, { at: pk, where: `park: ${pk.name}`, r: 400 });
  }
}

// 2. Playgrounds around every starting point, in one request (split into chunks if there are many).
const placed = todo.filter((t) => t.at);
const play = new Map();
for (let i = 0; i < placed.length; i += 60) {
  const chunk = placed.slice(i, i + 60);
  console.log(`Playgrounds around pins ${i + 1}-${i + chunk.length} of ${placed.length}`);
  const els = await overpass(`[out:json][timeout:300];(${chunk.map((t) => `nwr[leisure=playground](around:${t.r},${t.at.lat},${t.at.lng});`).join('')});out center tags;`);
  for (const e of els) {
    const c = centre(e);
    if (c.lat != null) play.set(`${e.type}/${e.id}`, { id: `${e.type}/${e.id}`, ...c, t: e.tags ?? {} });
  }
}
console.log(`${play.size} mapped playgrounds nearby`);

// 3. Choose each pin.
const lines = ['| id | from | where | result | metres | OpenStreetMap | already listed within 150 m |', '|---|---|---|---|---|---|---|'];
const used = new Set();
for (const t of todo) {
  const label = typeof t.src === 'string' ? t.src : t.src.park;
  if (!t.at) {
    lines.push(`| ${t.id} | ${label} | ? | ${typeof t.src === 'string' ? 'POSTCODE NOT FOUND' : 'PARK NOT FOUND'} | | | |`);
    continue;
  }
  const ours = new Set([...words(t.doc.name), ...words(t.doc.area)]);
  const cands = [...play.values()]
    .filter((c) => !used.has(c.id) && c.t.indoor !== 'yes' && c.t.access !== 'private' && (MEMBERS || !['no', 'customers'].includes(c.t.access)))
    .map((c) => {
      const text = `${c.t.name ?? ''} ${c.t.operator ?? ''}`.toLowerCase();
      const strong = words(text).some((w) => ours.has(w)) || (MEMBERS && ((ORG[t.doc.membership] ?? []).some((o) => text.includes(o)) || ['customers', 'permissive'].includes(c.t.access)));
      return { ...c, d: Math.round(metres(t.at, c)), strong };
    })
    .filter((c) => c.d <= t.r)
    .sort((a, b) => a.d - b.d);
  const pick = cands.find((c) => c.strong) ?? (typeof t.src === 'string' ? cands.find((c) => c.d <= 250) : cands[0]);
  const doc = t.doc;
  const to = pick ?? t.at;
  doc.lat = Math.round(to.lat * 1e5) / 1e5;
  doc.lng = Math.round(to.lng * 1e5) / 1e5;
  if (pick) {
    used.add(pick.id);
    doc.notConfirmed = doc.notConfirmed.replace(/Exact position \((mapped from the postcode|approximate)\)/, 'Exact position (taken from OpenStreetMap)');
  } else if (typeof t.src !== 'string') {
    doc.notConfirmed = doc.notConfirmed.replace('Exact position (approximate)', "Exact position (approximate: the middle of the park)");
  }
  await writeFile(`src/content/playgrounds/${t.id}.json`, JSON.stringify(doc, null, 2) + '\n');
  const dups = others.filter((o) => metres(o, doc) <= 150).map((o) => `${o.id} (${Math.round(metres(o, doc))}m)`);
  const rest = cands.filter((c) => c !== pick).slice(0, 3).map((c) => `${c.d}m ${c.t.name ?? 'unnamed'}${c.t.access ? ` (${c.t.access})` : ''}`).join('; ');
  lines.push(`| ${t.id} | ${label} | ${t.where} | ${pick ? (pick.strong ? 'moved (match)' : 'moved (near)') : 'stays'} | ${pick?.d ?? ''} | ${pick ? `${pick.id} ${pick.t.name ?? 'unnamed'} ${pick.t.access ?? ''}` : ''}${rest ? ` · others: ${rest}` : ''} | ${dups.join(', ')} |`);
}
await writeFile('tmp/pins-report.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));

// Temporary (removed before merge): places the new London playgrounds' pins (public playgrounds only).
// Geocodes each postcode in tmp/new-pins.json with postcodes.io, then looks for playgrounds mapped on OpenStreetMap
// within 1.5 km. Membership play areas are usually tagged access=customers, so unlike check-positions.mjs those count.
// A pin moves onto the nearest mapped playground whose name or operator shares a word with ours, or that is marked
// customers/permissive; failing that, onto any non-private one within 300 m; otherwise it stays on the postcode.
import { readFile, writeFile } from 'node:fs/promises';

const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; placing playground pins)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const GENERIC = new Set('play area areas playground playgrounds park parks adventure natural the and of garden gardens castle hall house centre estate wild woodland rhs wwt'.split(' '));
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
const ORG = { nt: ['national trust'], hh: [], rhs: ['royal horticultural', 'rhs'], wwt: ['wildfowl', 'wetland', 'wwt'], nts: ['national trust for scotland', 'national trust'] };

async function overpass(q) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(OVERPASS[i % 3], { method: 'POST', headers: UA, body: new URLSearchParams({ data: q }) });
      if (r.ok) return (await r.json()).elements;
    } catch {}
    await sleep(15000);
  }
  return null;
}

const pcs = JSON.parse(await readFile('tmp/new-pins.json', 'utf8'));
const { readdir } = await import('node:fs/promises');
const others = [];
for (const f of await readdir('src/content/playgrounds')) {
  const id = f.replace(/\.json$/, '');
  if (pcs[id]) continue;
  const d = JSON.parse(await readFile(`src/content/playgrounds/${f}`, 'utf8'));
  others.push({ id, name: d.name, lat: d.lat, lng: d.lng });
}
const geo = await (await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: Object.values(pcs) }) })).json();
const byPc = Object.fromEntries(geo.result.map((x) => [x.query, x.result]));
const lines = ['| id | postcode | district | result | metres | OpenStreetMap | already listed within 150 m |', '|---|---|---|---|---|---|---|'];
for (const [id, pc] of Object.entries(pcs)) {
  const file = `src/content/playgrounds/${id}.json`;
  const doc = JSON.parse(await readFile(file, 'utf8'));
  const g = byPc[pc];
  if (!g) {
    lines.push(`| ${id} | ${pc} | ? | POSTCODE NOT FOUND | | |`);
    continue;
  }
  const at = { lat: g.latitude, lng: g.longitude };
  const els = (await overpass(`[out:json][timeout:60];nwr[leisure=playground](around:1500,${at.lat},${at.lng});out center tags;`)) ?? [];
  const ours = new Set([...words(doc.name), ...words(doc.area)]);
  const cands = els
    .map((e) => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, t: e.tags ?? {} }))
    .filter((c) => c.lat != null && !['private', 'no', 'customers'].includes(c.t.access) && c.t.indoor !== 'yes')
    .map((c) => {
      const text = `${c.t.name ?? ''} ${c.t.operator ?? ''}`.toLowerCase();
      const strong = words(text).some((w) => ours.has(w));
      return { ...c, d: Math.round(metres(at, c)), strong };
    })
    .sort((a, b) => a.d - b.d);
  const pick = cands.find((c) => c.strong && c.d <= 1500) ?? cands.find((c) => c.d <= 250);
  if (pick) {
    doc.lat = Math.round(pick.lat * 1e5) / 1e5;
    doc.lng = Math.round(pick.lng * 1e5) / 1e5;
    doc.notConfirmed = doc.notConfirmed.replace('Exact position (mapped from the postcode)', 'Exact position (taken from OpenStreetMap)');
  } else {
    doc.lat = Math.round(at.lat * 1e5) / 1e5;
    doc.lng = Math.round(at.lng * 1e5) / 1e5;
  }
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n');
  const dups = others.filter((o) => metres(o, doc) <= 150).map((o) => `${o.id} (${Math.round(metres(o, doc))}m)`);
  const others2 = cands.filter((c) => c !== pick).slice(0, 3).map((c) => `${c.d}m ${c.t.name ?? 'unnamed'}${c.t.access ? ` (${c.t.access})` : ''}`).join('; ');
  lines.push(`| ${id} | ${pc} | ${g.admin_district} | ${pick ? (pick.strong ? 'moved (match)' : 'moved (near)') : 'postcode'} | ${pick?.d ?? ''} | ${pick ? `${pick.id} ${pick.t.name ?? 'unnamed'} ${pick.t.access ?? ''}` : ''}${others2 ? ` · others: ${others2}` : ''} | ${dups.join(', ')} |`);
  await sleep(1500);
}
await writeFile('tmp/pins-report.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));

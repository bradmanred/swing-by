// Playgrounds removed in November 2026 for being inside school grounds (src/data/school-grounds.json) come back as
// soon as any official source lists them: a council or parish list read by the coverage check, a fix from the
// quarterly check's report, or one added by hand. This clears the entry of every one that now has a listing with an
// official source (not OpenStreetMap or a photo site) at its OpenStreetMap id or within 150 m, so the list only holds
// those still waiting. Run by the coverage check after it adds playgrounds, and on its own:
//   node scripts/school-grounds.mjs [--dir src/content/playgrounds] [--file src/data/school-grounds.json]
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAME_M, osmIds } from './same-place.mjs';

const OFFICIAL = (s) => !/openstreetmap\.org\/|geograph\.org\.uk|commons\.wikimedia\.org/.test(s.url);
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

/** Clears entries with an official listing; returns [{ osm, was, by }] for the ones cleared. */
export async function clearListed(dir = 'src/content/playgrounds', file = 'src/data/school-grounds.json') {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const entries = Object.entries(data.playgrounds);
  if (!entries.length) return [];
  const grid = new Map();
  const key = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 60)}`;
  const byOsm = new Map();
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (!(d.sources ?? []).some(OFFICIAL)) continue;
    const p = { id: f.replace(/\.json$/, ''), lat: d.lat, lng: d.lng };
    grid.set(key(p.lat, p.lng), [...(grid.get(key(p.lat, p.lng)) ?? []), p]);
    for (const o of osmIds(d.sources)) byOsm.set(o, p);
  }
  const cleared = [];
  for (const [osm, was] of entries) {
    let by = byOsm.get(osm);
    for (let a = -1; a <= 1 && !by; a++)
      for (let b = -1; b <= 1 && !by; b++)
        by = (grid.get(`${Math.floor(was.lat * 100) + a},${Math.floor(was.lng * 60) + b}`) ?? []).find((p) => metres(p, was) <= SAME_M);
    if (by) {
      cleared.push({ osm, was, by: by.id });
      delete data.playgrounds[osm];
    }
  }
  if (cleared.length) await writeFile(file, JSON.stringify(data, null, 1) + '\n');
  return cleared;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  const cleared = await clearListed(arg('--dir'), arg('--file'));
  console.log(cleared.length ? cleared.map((c) => `Back on an official source: ${c.was.name}, ${c.was.area} (${c.osm}) as ${c.by}`).join('\n') : 'None of the school-grounds playgrounds has an official listing yet.');
}

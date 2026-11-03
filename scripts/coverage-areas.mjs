// Works out which counties (English ceremonial counties) and nations Swing By covers, for the home page.
// Looks up every playground's local authority on postcodes.io and writes src/data/coverage.json.
//
//   node scripts/coverage-areas.mjs
//
// Run by the "Update nearest toilets" workflow whenever playgrounds change.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { countyOf } from './counties.mjs';

const DIR = 'src/content/playgrounds';
const OUT = 'src/data/coverage.json';
const MIN = 3; // a county counts once it has at least this many playgrounds


const pts = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  pts.push({ lat: d.lat, lng: d.lng });
}
const counties = {}, nations = {};
for (let i = 0; i < pts.length; i += 100) {
  const chunk = pts.slice(i, i + 100);
  const res = await fetch('https://api.postcodes.io/postcodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 2000, limit: 1 })) }),
  }).then((r) => (r.ok ? r.json() : null));
  if (!res) throw new Error('postcodes.io could not be reached');
  for (const x of res.result) {
    const p = x.result?.[0];
    if (!p) continue;
    const c = countyOf(p);
    if (p.country && p.country !== 'England') nations[c] = (nations[c] ?? 0) + 1;
    else counties[c] = (counties[c] ?? 0) + 1;
  }
}
const sortDesc = (o) => Object.entries(o).filter(([, n]) => n >= MIN).sort((a, b) => b[1] - a[1]).map(([name, playgrounds]) => ({ name, playgrounds }));
const out = { updated: new Date().toISOString().slice(0, 10), counties: sortDesc(counties), nations: sortDesc(nations) };
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.counties.length} counties: ${out.counties.map((c) => `${c.name} ${c.playgrounds}`).join(', ')}`);
console.log(`Nations: ${out.nations.map((c) => `${c.name} ${c.playgrounds}`).join(', ')}`);

// Compares the street and place names the snapshot gives (scripts/osm-names.mjs) with the ones Nominatim gave the
// playgrounds already on the site, to check the snapshot names are good enough before relying on them.
// Only listings imported from OpenStreetMap are compared (their descriptions say "A playground on OpenStreetMap
// near <street>, <place>"), since hand-written ones use their own wording.
//
//   node scripts/osm-names-check.mjs osm-playgrounds.json(.gz) osm-places.json(.gz) [osm-areas.json(.gz)] [--show 20]
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addressFor, loadJson } from './osm-names.mjs';
import { osmIds } from './same-place.mjs';

const [snapFile, placesFile, areasFile] = process.argv.slice(2).filter((a, i, all) => a !== '--show' && all[i - 1] !== '--show');
const SHOW = Number(process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : 15);
if (!snapFile || !placesFile) throw new Error('Usage: node scripts/osm-names-check.mjs osm-playgrounds.json.gz osm-places.json.gz');
const address = addressFor(await loadJson(snapFile), await loadJson(placesFile), areasFile ? await loadJson(areasFile) : []);
const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
const DIR = 'src/content/playgrounds';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const t = { compared: 0, notInSnapshot: 0, road: 0, roadBothEmpty: 0, area: 0, town: 0 };
const misses = { road: [], area: [] };
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const m = String(d.description ?? '').match(/^A playground on OpenStreetMap(?: near ([^.]*))?\./);
  if (!m) continue;
  const id = osmIds(d.sources)[0];
  if (!id) continue;
  const a = await address(d, id);
  if (a.from !== 'snapshot') {
    t.notInSnapshot++;
    continue;
  }
  t.compared++;
  // What Nominatim gave: "near Road, Place", or "near Place" when there was no usable road.
  const near = (m[1] ?? '').split(', ');
  const nameRoad = (d.name.match(/^Playground off (.+)$/) ?? [])[1];
  const oldRoad = nameRoad ?? (near.length > 1 ? near[0] : '');
  let road = a.road;
  if (BIG_ROAD.test(road)) road = '';
  if (norm(road) === norm(oldRoad)) {
    t.road++;
    if (!road) t.roadBothEmpty++;
  } else misses.road.push(`${f}: was "${oldRoad}", snapshot "${road}"`);
  const area = [...new Set([a.sub, a.town].filter(Boolean))].join(', ');
  if (norm(area) === norm(d.area)) t.area++;
  else misses.area.push(`${f}: was "${d.area}", snapshot "${area}"`);
  // The town alone (the last part of the area), which the file name and area pages lean on most.
  if (norm(a.town) === norm(String(d.area).split(', ').at(-1))) t.town++;
}
const pct = (n) => `${Math.round((100 * n) / Math.max(1, t.compared))}%`;
console.log(`Compared ${t.compared} OpenStreetMap-imported playgrounds (${t.notInSnapshot} no longer in the snapshot).`);
console.log(`Street name the same: ${t.road} (${pct(t.road)}; ${t.roadBothEmpty} with no street either way)`);
console.log(`Area the same: ${t.area} (${pct(t.area)}); town the same: ${t.town} (${pct(t.town)})`);
for (const k of ['road', 'area']) {
  console.log(`\nSome ${k} differences:`);
  for (const line of misses[k].sort(() => Math.random() - 0.5).slice(0, SHOW)) console.log(`  ${line}`);
}

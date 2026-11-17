// Re-names automatically imported playgrounds from the OpenStreetMap snapshot (scripts/osm-names.mjs), for listings
// named by the old one-at-a-time Nominatim lookup, which sometimes picked a place a mile or two away (Eddington
// Crescent, Welwyn Garden City was "Hatfield Garden Village"; Brocket Road in Lemsford too).
//
// Only listings the coverage check wrote are touched, recognised by their stock descriptions:
//   - OpenStreetMap imports: the area, the "near …" part of the description, and names we made up ourselves
//     ("Playground off <street>", "<place> Playground"). Names from OpenStreetMap's own name tag are kept.
//   - Council imports: the area only (the council gives the name).
// Hand-written listings are left alone. File names don't change, so links keep working.
//
//   node scripts/rename-areas.mjs osm-playgrounds.json.gz osm-places.json.gz osm-areas.json.gz [--write] [--show 30]
//
// Without --write it only reports what it would change. Postcodes.io isn't asked: the old town stands in for the
// council district (so a point inside a city's district still gets the city), and the region for London.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { areasAt, loadJson, PLACE_KM, placeIndex, placeNames } from './osm-names.mjs';
import { osmIds } from './same-place.mjs';

const args = process.argv.slice(2);
const SHOW = Number(args.includes('--show') ? args[args.indexOf('--show') + 1] : 30);
const WRITE = args.includes('--write');
const [snapFile, placesFile, areasFile] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--show');
if (!snapFile || !placesFile) throw new Error('Usage: node scripts/rename-areas.mjs osm-playgrounds.json.gz osm-places.json.gz [osm-areas.json.gz] [--write]');

const snapshot = new Map((await loadJson(snapFile)).map((p) => [p.id, p]));
const places = await loadJson(placesFile);
const index = placeIndex(places, areasFile ? await loadJson(areasFile) : []);
const byName = new Map();
for (const q of places) (byName.get(q.n) ?? byName.set(q.n, []).get(q.n)).push(q);
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// A name in an area is fine if it's a mapped place the point is inside, or one whose point is within the distance
// that kind of place reaches (a town or city a little further). Council districts ("East Devon", "Welwyn Hatfield")
// and parishes ("Totton and Eling") aren't places, and a suburb two miles off isn't where the playground is.
// Big villages spread well beyond their map point, so villages and hamlets get twice their reach, and a parish
// outline counts when a village of the same name exists (most villages are their own parish).
const SLACK = { town: 1.5, city: 1.5, village: 2, hamlet: 2, suburb: 1.25, quarter: 1.25, neighbourhood: 1.5 };
const fits = (name, p) =>
  name === 'Greater London' ||
  areasAt(index, p).some((a) => a.n === name && (a.k !== 'parish' || (byName.get(name) ?? []).some((q) => q.k === 'village' || q.k === 'hamlet' || q.k === 'town'))) ||
  (byName.get(name) ?? []).some((q) => km(p, q) <= (PLACE_KM[q.k] ?? 0) * (SLACK[q.k] ?? 1));
const DIR = 'src/content/playgrounds';
const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
const OSM_STOCK = /^A playground on OpenStreetMap(?: near ([^.]*))?\.( .*)$/;
const COUNCIL_STOCK = /^A playground on .+'s own list of play areas\.$/;

const t = { looked: 0, notInSnapshot: 0, area: 0, name: 0, files: 0 };
const changes = [];
const why = {};
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const osm = String(d.description ?? '').match(OSM_STOCK);
  const council = !osm && COUNCIL_STOCK.test(d.description ?? '');
  if (!osm && !council) continue;
  t.looked++;
  const s = snapshot.get(osmIds(d.sources)[0]);
  if (!s) {
    t.notInSnapshot++;
    continue;
  }
  const [oldSub, oldTown = oldSub] = String(d.area).split(', ');
  const wrong = [...new Set([oldSub, oldTown])].filter((n) => !fits(n, s));
  if (!wrong.length) continue;
  const a = placeNames(index, s, { admin_district: oldTown, region: d.region === 'london' ? 'London' : '' });
  // Keep whichever part is right; replace only the wrong one (or drop it, if the snapshot has nothing better).
  const sub = fits(oldSub, s) ? oldSub : a.sub && fits(a.sub, s) ? a.sub : '';
  const town = fits(oldTown, s) ? oldTown : a.town && fits(a.town, s) ? a.town : '';
  const area = [...new Set([sub, town].filter(Boolean))].join(', ');
  if (!area || area === d.area) continue; // nothing better to offer
  const place = sub || town;
  const next = { ...d };
  if (area && area !== d.area) next.area = area;
  if (osm) {
    // Keep the street: both lookups just take the nearest one. Only a road number gets a proper street name.
    const oldNear = (osm[1] ?? '').split(', ');
    const oldRoad = (d.name.match(/^Playground off (.+)$/) ?? [])[1] ?? (oldNear.length > 1 ? oldNear[0] : '');
    const snapRoad = BIG_ROAD.test(s.road ?? '') ? '' : (s.road ?? '');
    const road = /^[ABM]\d+/.test(oldRoad) && snapRoad ? snapRoad : oldRoad;
    const oldPlace = oldSub;
    if (/^Playground off /.test(d.name)) {
      if (road && road !== oldRoad) next.name = `Playground off ${road}`;
    } else if ((d.name === `${oldPlace} Playground` || d.name === `${oldTown} Playground`) && place !== 'Greater London') {
      next.name = `${place} Playground`;
    }
    const near = [road, place].filter(Boolean).join(', ');
    next.description = `A playground on OpenStreetMap${near ? ` near ${near}` : ''}.${osm[2]}`;
  }
  const changed = ['area', 'name', 'description'].filter((k) => next[k] !== d[k]);
  if (!changed.length) continue;
  t.files++;
  for (const n of wrong) why[n] = (why[n] ?? 0) + 1;
  if (next.area !== d.area) t.area++;
  if (next.name !== d.name) t.name++;
  changes.push(`${f}: ${next.name !== d.name ? `"${d.name}" → "${next.name}"; ` : ''}${next.area !== d.area ? `"${d.area}" → "${next.area}"` : '(description only)'}`);
  if (WRITE) await writeFile(join(DIR, f), JSON.stringify(next, null, 2) + '\n');
}
console.log(`Looked at ${t.looked} imported listings (${t.notInSnapshot} not in the snapshot, left as they are).`);
console.log(`${WRITE ? 'Changed' : 'Would change'} ${t.files}: ${t.area} areas, ${t.name} names.`);
console.log('Most common names replaced:', Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${n} (${c})`).join(', '));
for (const line of changes.sort(() => Math.random() - 0.5).slice(0, SHOW)) console.log(`  ${line}`);

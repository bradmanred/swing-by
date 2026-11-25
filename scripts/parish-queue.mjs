// The town and parish councils to check next, biggest gap first. Every listing that is Unverified (from OpenStreetMap
// only) is put in its parish, from the parish outlines in the monthly OpenStreetMap snapshot (OSM_AREAS); parishes
// whose council is already in src/data/council-sources.json are left out, and the rest are ranked by how many
// Unverified listings they hold. A council's own list would turn those into verified listings (docs/finding-playgrounds.md).
// A second list shows registered town and parish councils whose lists still leave many Unverified listings behind.
//
//   OSM_AREAS=/tmp/areas.json node scripts/parish-queue.mjs [--out reports] [--batch 30] [--min 5] [--no-lookup]
//
// Each parish's district and its name as postcodes.io gives it (which council-sources.json needs) come from one
// postcodes.io lookup at a listing inside it; --no-lookup skips that (the district is then left blank). Writes
// parish-queue.md (the issue body: the next batch, then the rest of the top 100) and parish-queue.json (every parish).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parishFinder, parishKey } from './parishes.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg('--out', 'reports');
const BATCH = Number(arg('--batch', process.env.PARISH_BATCH || 30)) || 30;
const MIN = Number(arg('--min', 5)) || 5;
const LOOKUP = !process.argv.includes('--no-lookup');
const DIR = 'src/content/playgrounds';

if (!process.env.OSM_AREAS) {
  console.error('OSM_AREAS is not set: run with the OpenStreetMap snapshot (.github/actions/osm-snapshot).');
  process.exit(1);
}

const osmOnly = (d) => !d.checked && (d.sources ?? []).length > 0 && d.sources.every((s) => /openstreetmap\.org\//.test(s.url));

const areas = JSON.parse(await readFile(process.env.OSM_AREAS, 'utf8'));
const parishOf = parishFinder(areas);
const councils = JSON.parse(await readFile('src/data/council-sources.json', 'utf8')).councils;
const registered = new Map(councils.filter((c) => c.parish).map((c) => [parishKey(c.parish), c]));

const byParish = new Map(); // name → { name, unverified, verified, at }
let unverified = 0, unparished = 0;
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const only = osmOnly(d);
  if (only) unverified++;
  const name = parishOf(d.lng, d.lat);
  if (!name) {
    if (only) unparished++;
    continue;
  }
  if (!byParish.has(name)) byParish.set(name, { name, unverified: 0, verified: 0, at: null });
  const p = byParish.get(name);
  if (only) {
    p.unverified++;
    p.at ??= { lat: d.lat, lng: d.lng };
  } else if (d.checked) p.verified++;
}

const all = [...byParish.values()].filter((p) => p.unverified > 0).sort((a, b) => b.unverified - a.unverified || a.name.localeCompare(b.name));
const todo = all.filter((p) => !registered.has(parishKey(p.name)) && p.unverified >= MIN);
const behind = all
  .filter((p) => registered.get(parishKey(p.name))?.feed && p.unverified >= 10 && p.verified > 0) // read at least once
  .map((p) => ({ ...p, council: registered.get(parishKey(p.name)).council }));

// District and postcodes.io's parish name, 100 points per request.
async function lookup(list) {
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      const r = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.at.lat, longitude: p.at.lng, radius: 800, limit: 1 })) }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json();
      j.result?.forEach((x, k) => {
        const pc = x.result?.[0];
        if (pc) Object.assign(chunk[k], { district: pc.admin_district, county: pc.admin_county ?? pc.region ?? pc.country, pcParish: pc.parish });
      });
    } catch (e) {
      console.log(`postcodes.io lookup failed (${e.message}); districts left blank.`);
      return;
    }
  }
}
if (LOOKUP) await lookup(todo.slice(0, 200));
// A parish registered under postcodes.io's spelling isn't still to do.
const queue = todo.filter((p) => !(p.pcParish && registered.has(parishKey(p.pcParish))));

const search = (p) => `https://duckduckgo.com/?q=${encodeURIComponent(`"${p.pcParish ?? p.name}" town OR parish council play areas`)}`;
const line = (p, i) => `| ${i + 1} | ${p.pcParish ?? p.name} | ${p.district ?? ''} | ${p.unverified} | ${p.verified} | [search](${search(p)}) |`;
const head = ['| # | Town or parish | District | Unverified | Verified | Look for its list |', '|---:|---|---|---:|---:|---|'];
const ten = queue.filter((p) => p.unverified >= 10).length;
const md = [
  `${unverified.toLocaleString('en-GB')} listings are Unverified (OpenStreetMap only): ${unparished.toLocaleString('en-GB')} in areas with no parish council (the district council's list is the only source there, and every district is registered), the rest in parishes. ${queue.length} town and parish councils that aren't registered yet hold ${MIN} or more, ${ten} of them 10 or more.`,
  '',
  `## This batch: the next ${Math.min(BATCH, queue.length)}`,
  '',
  'Check each council in order, following docs/finding-playgrounds.md, and register it in src/data/council-sources.json with its district and "parish" as shown here: with a list or feed if it names its play areas, or with a note saying what you found (who runs the play areas instead) if not. See "Parish councils to check" in docs/fixing-check-reports.md.',
  '',
  ...head,
  ...queue.slice(0, BATCH).map(line),
];
if (queue.length > BATCH)
  md.push('', '## Next in line', '', 'For the following batches. The ranking is worked out again each week, so it shifts as listings are verified.', '', ...head, ...queue.slice(BATCH, 100).map((p, i) => line(p, i + BATCH)), ...(queue.length > 100 ? ['', `…and ${queue.length - 100} more.`] : []));
if (behind.length)
  md.push(
    '',
    '## Registered, but their lists leave many Unverified',
    '',
    "These councils are registered with a list, but many listings in their parish are still Unverified. Either the list misses some (look for a fuller one), or those play areas are the district council's.",
    '',
    '| Town or parish | Council | Unverified | Verified |',
    '|---|---|---:|---:|',
    ...behind.slice(0, 15).map((p) => `| ${p.name} | ${p.council} | ${p.unverified} | ${p.verified} |`),
  );

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'parish-queue.md'), md.join('\n') + '\n');
await writeFile(join(OUT, 'parish-queue.json'), JSON.stringify({ unverified, unparished, queue, behind }, null, 1) + '\n');
console.log(`${unverified} Unverified, ${unparished} unparished; ${queue.length} parishes to check (${ten} with 10 or more). Next: ${queue.slice(0, 5).map((p) => `${p.pcParish ?? p.name} (${p.unverified})`).join(', ')}`);

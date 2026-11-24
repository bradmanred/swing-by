// Playgrounds removed in November 2026 for being inside school grounds (src/data/school-grounds.json) come back as
// soon as any official source lists them, or two parents confirm they're open to everyone.
//
// Official sources: a council or parish list read by the coverage check, a fix from the quarterly check's report, or
// one added by hand. clearListed() clears the entry of every one that now has a listing with an official source (not
// OpenStreetMap or a photo site) at its OpenStreetMap id or within 150 m. Run by the coverage check after it adds
// playgrounds.
//
// Parents: each old address shows a page asking "Is it a public playground anyone can use?" (worker/school-grounds.js),
// counted like the same question on every playground page: two parents from different households, and more saying
// yes than no (worker/equipment.js). With --parents, this reads /api/equipment/open and puts back each one parents
// agree on, under its old address, from OpenStreetMap as before, and clears its entry. Run every morning by the
// "Move pins parents agree on" workflow.
//
//   node scripts/school-grounds.mjs [--dir src/content/playgrounds] [--file src/data/school-grounds.json]
//   SITE=https://swing-by.co.uk node scripts/school-grounds.mjs --parents [--open open.json] [--report reports/parent-pins.md]
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

/**
 * Puts back each one whose old page address is in openParks (playgrounds two parents confirm are public, from
 * /api/equipment/open), and clears its entry. Returns [{ osm, was }] for the ones put back.
 */
export async function restoreConfirmed(openParks, dir = 'src/content/playgrounds', file = 'src/data/school-grounds.json') {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const confirmed = new Set(openParks);
  const back = [];
  for (const [osm, was] of Object.entries(data.playgrounds)) {
    if (!confirmed.has(was.page)) continue;
    const doc = {
      name: was.name,
      region: was.region,
      area: was.area,
      lat: was.lat,
      lng: was.lng,
      ages: [],
      equipment: [],
      access: [],
      facilities: [],
      opens: '',
      description: `A playground on OpenStreetMap in ${was.area}. The map puts it inside school grounds, but parents have told us it's open to everyone. No council list we've checked includes it yet.`,
      nearby: [],
      sources: [{ label: 'OpenStreetMap: playground', url: `https://www.openstreetmap.org/${osm}` }],
      checked: null,
      notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges, play equipment, opening hours, toilets and parking. Listed from OpenStreetMap (© OpenStreetMap contributors); parents confirm it is open to the public.',
      photo: null,
    };
    await writeFile(join(dir, `${was.page}.json`), JSON.stringify(doc, null, 2) + '\n');
    delete data.playgrounds[osm];
    back.push({ osm, was });
  }
  if (back.length) await writeFile(file, JSON.stringify(data, null, 1) + '\n');
  return back;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
  if (process.argv.includes('--parents')) {
    const site = process.env.SITE || 'https://swing-by.co.uk';
    const open = arg('--open') ? JSON.parse(await readFile(arg('--open'), 'utf8')) : await fetch(`${site}/api/equipment/open`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/equipment/open answered ${r.status}`))));
    const back = await restoreConfirmed(open.parks ?? [], arg('--dir'), arg('--file'));
    const lines = back.map((b) => `- [${b.was.name}, ${b.was.area}](${site}/playgrounds/${b.was.page}/): parents confirm it's open to everyone ([${b.osm}](https://www.openstreetmap.org/${b.osm}))`);
    console.log(back.length ? `Put back (parents confirm they're public):\n${lines.join('\n')}` : 'Parents have not confirmed any of the school-grounds playgrounds yet.');
    if (back.length && arg('--report')) await mkdir(dirname(arg('--report')), { recursive: true });
    if (back.length && arg('--report')) await appendFile(arg('--report'), `\n## Back from the school-grounds list\n\nTaken off in November 2026 for being inside school grounds; two parents now confirm they're open to everyone.\n\n${lines.join('\n')}\n`);
    process.exit(0);
  }
  const cleared = await clearListed(arg('--dir'), arg('--file'));
  console.log(cleared.length ? cleared.map((c) => `Back on an official source: ${c.was.name}, ${c.was.area} (${c.osm}) as ${c.by}`).join('\n') : 'None of the school-grounds playgrounds has an official listing yet.');
}

// Brings playgrounds already listed from OpenStreetMap alone (Unverified) up to what the importers now do for new ones
// (scripts/osm-details.mjs), from the monthly snapshot (OSM_PLAYGROUNDS, set by .github/actions/osm-snapshot):
//
// - Names: a made-up name ("Playground off Elm Road", "Sidmouth Playground") becomes the playground's own name if it
//   has been given one on OpenStreetMap since, or else the park it's in ("Victoria Park Playground"). The file is
//   renamed to match and the old address redirects to the new one (worker/index.js).
// - Details: empty age ranges, equipment and step-free access are filled from what's mapped, and notConfirmed says so.
// - Grounds: ones the snapshot puts inside a school, pub, hotel or holiday park are listed in the report for a person
//   to look at. Nothing is ever deleted.
//
// Playgrounds with a checked date, any official source, a photo, or a pin placed by hand (src/data/pins-checked.json)
// are left alone.
//
//   node scripts/osm-tidy.mjs                  change the files, report in reports/osm-tidy.md
//   node scripts/osm-tidy.mjs --dry-run        report only
//   node scripts/osm-tidy.mjs --renames 2000   rename at most this many (default 3000, to keep a pull request reviewable)
//   node scripts/osm-tidy.mjs --region devon   only one region
//
// Run by .github/workflows/osm-tidy.yml.
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OSM_DESCRIPTION, madeUpName, ownName, osmDescription, osmDetails, osmNotConfirmed, playgroundName } from './osm-details.mjs';
import { loadJson } from './osm-names.mjs';

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const DIR = arg('--dir', 'src/content/playgrounds');
const OUT = arg('--out', 'reports');
const DRY = process.argv.includes('--dry-run');
const MAX_RENAMES = Number(arg('--renames', 3000));
const REGION = arg('--region', '');
const WORKER = arg('--worker', 'worker/index.js');
const SITE = 'https://swing-by.co.uk/playgrounds/';

if (!process.env.OSM_PLAYGROUNDS) throw new Error('Needs the OpenStreetMap snapshot: set OSM_PLAYGROUNDS (the osm-snapshot action does).');
const snapshot = new Map((await loadJson(process.env.OSM_PLAYGROUNDS)).map((p) => [p.id, p]));
const newFormat = [...snapshot.values()].some((p) => p.park || p.equip || p.within);
if (!newFormat) console.log('The snapshot has no park, equipment or grounds details yet (made before November 2026): only new OpenStreetMap names will be used.');
const handPlaced = new Set(JSON.parse(await readFile('src/data/pins-checked.json', 'utf8').catch(() => '{"pins":[]}')).pins.map((p) => p.id));

const OSM_RE = /openstreetmap\.org\/((?:node|way|relation)\/\d+)/;
const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const STOCK_NC = /^Exact position \(taken from OpenStreetMap\), age ranges, play equipment, opening hours, toilets and parking\./;

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
const existing = new Set(files);
const renamed = [], filled = [], inGrounds = [];
let looked = 0;
for (const f of files) {
  const id = f.replace(/\.json$/, '');
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const sources = d.sources ?? [];
  if (d.checked || d.photo || handPlaced.has(id) || !sources.length || !sources.every((s) => OSM_RE.test(s.url))) continue;
  if (REGION && d.region !== REGION) continue;
  const p = snapshot.get(sources[0].url.match(OSM_RE)[1]);
  if (!p) continue;
  looked++;
  if (p.within) inGrounds.push({ id, name: d.name, within: p.within, osm: p.id });

  let changed = false;
  // Details, only where the file has none.
  const det = osmDetails(p);
  const add = {};
  for (const k of ['ages', 'equipment', 'access']) if (!(d[k] ?? []).length && det[k].length) (d[k] = det[k]), (add[k] = det[k]);
  if (Object.keys(add).length) {
    if (STOCK_NC.test(d.notConfirmed ?? '')) d.notConfirmed = osmNotConfirmed({ ages: d.ages, equipment: d.equipment });
    filled.push({ id, name: d.name, add });
    changed = true;
  }

  // Name.
  const place = String(d.area ?? '').split(',')[0].trim();
  // Only when OpenStreetMap now gives it a name of its own or a park: otherwise the street name stays.
  const road = (d.name.match(/ off (.+)$/) ?? [])[1] ?? '';
  const better = playgroundName({ tagName: p.tags?.name ?? '', park: p.park ?? '', road, place });
  let newId = id;
  if (madeUpName(d.name, place) && (ownName(p.tags?.name) || p.park) && better !== d.name && renamed.length < MAX_RENAMES) {
    const old = d.name;
    d.name = better;
    const m = (d.description ?? '').match(OSM_DESCRIPTION);
    if (m) {
      const near = (m[2] ?? '').replace(/^ near /, '');
      const where = p.park && !better.includes(p.park) ? ` in ${p.park}` : '';
      d.description = osmDescription({ where, near, fee: det.fee });
    }
    newId = slug(`${d.name}-${d.area}`).slice(0, 60);
    // Same name twice in one place: -2, -3, -4 (not -2-2).
    for (let n = 2, base = newId; existing.has(`${newId}.json`) && newId !== id; n++) newId = `${base}-${n}`;
    existing.add(`${newId}.json`);
    renamed.push({ from: id, to: newId, old, name: d.name });
    changed = true;
  }

  if (!changed || DRY) continue;
  await writeFile(join(DIR, `${newId}.json`), JSON.stringify(d, null, 2) + '\n');
  if (newId !== id) {
    await unlink(join(DIR, f));
    existing.delete(f);
  }
}

// Old addresses of renamed listings keep working (worker/index.js sends them to the new one).
const moves = renamed.filter((r) => r.from !== r.to);
if (moves.length && !DRY) {
  const w = await readFile(WORKER, 'utf8');
  await writeFile(WORKER, w.replace(/(const MERGED = \{\n)/, `$1${moves.map((r) => `  '${r.from}': '${r.to}',`).join('\n')}\n`));
}

const MAX = 60;
const more = (n) => (n > MAX ? [`- …and ${n - MAX} more`] : []);
const L = [
  `# Tidy of OpenStreetMap-only playgrounds, ${new Date().toISOString().slice(0, 10)}`,
  '',
  `${looked} Unverified playgrounds listed from OpenStreetMap alone found in the snapshot${REGION ? ` (region ${REGION})` : ''}${DRY ? ' (dry run: nothing changed)' : ''}.`,
  '',
  `- **Renamed:** ${renamed.length}${renamed.length >= MAX_RENAMES ? ` (the limit for one run; run it again for the rest)` : ''}. Old addresses redirect.`,
  `- **Details filled in from OpenStreetMap:** ${filled.length}`,
  `- **Inside school, pub, hotel or holiday park grounds:** ${inGrounds.length} (not changed: check each)`,
  '',
  '## Renamed',
  '',
  ...(renamed.length ? renamed.slice(0, MAX).map((r) => `- "${r.old}" → [${r.name}](${SITE}${r.to}/)`) : ['None.']),
  ...more(renamed.length),
  '',
  '## Inside school, pub, hotel or holiday park grounds',
  '',
  'OpenStreetMap puts these inside grounds whose playgrounds usually aren\'t open to everyone. Check each on OpenStreetMap and the council\'s site: if it really is private, follow the never-delete rule in docs/fixing-check-reports.md and say so in the description; if it\'s public (some parks share a fence with a school), leave it.',
  '',
  ...(inGrounds.length ? inGrounds.slice(0, MAX).map((x) => `- [${x.name}](${SITE}${x.id}/): inside ${x.within} grounds ([${x.osm}](https://www.openstreetmap.org/${x.osm}))`) : ['None.']),
  ...more(inGrounds.length),
];
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'osm-tidy.md'), L.join('\n') + '\n');
await writeFile(join(OUT, 'osm-tidy.json'), JSON.stringify({ renamed, filled, inGrounds }, null, 1) + '\n');
console.log(L.slice(0, 8).join('\n'));

// Checks where playground pins are, against playgrounds mapped on OpenStreetMap.
//
// Early playgrounds were pinned by hand, from a postcode or from a street name, before positions came from
// OpenStreetMap. Some of those pins are well off (Queen's Park in Chesterfield was 400 m outside the park). This finds
// them: for every playground whose position did NOT come from OpenStreetMap or the council's own map, it looks for the
// public playgrounds mapped on OpenStreetMap nearby and matches them one to one (nearest first, with a small bonus when
// the names share a word), then says what it found:
//
//   confirmed  a mapped playground is within 60 m: the pin is right
//   move       one clear match 60-250 m away (up to 500 m if the names share a word): the pin is probably wrong.
//              With --fix, it is moved onto the match
//   ambiguous  several mapped playgrounds could be the one, or the only one is far and its name says nothing, so a
//              person has to choose (listed with links, never moved)
//   unmatched  the mapped playgrounds nearby are already taken by other pins: another pin may be stacked on it
//   far        nothing mapped within 500 m: check by hand (the playground may simply be missing from OpenStreetMap)
//   name       on a mapped playground, but that playground's name shares no word with ours: it may be a different one
//              (Badgers Recreation Ground in Chesterfield was pinned on the wrong playground 360 m away). Never moved
//
//   node scripts/check-positions.mjs                          report only (reports/positions.md and positions.json)
//   node scripts/check-positions.mjs --region derbyshire      one region (the "region" in the playground files)
//   node scripts/check-positions.mjs --fix                    also move the pins marked "move"
//   node scripts/check-positions.mjs --include unrecorded,approximate,postcode,council-map   which pins to check
//   node scripts/check-positions.mjs --include osm            also look again at pins taken from OpenStreetMap
//
// Pins someone has placed by hand are listed in src/data/pins-checked.json and are never checked or moved, whatever
// --include says. Add a pin there whenever you move it by hand, so a later --fix can't move it back.
//
// A pin's source is read from its "notConfirmed" text: "taken from OpenStreetMap" (osm, skipped), "from the council's
// map" (council-map, skipped unless asked for), "mapped from the postcode" (postcode), "approximate" (approximate), or
// nothing recorded (unrecorded). Moved pins say "taken from OpenStreetMap" afterwards, so they are only checked once.
// Options for testing: --dir (playground files), --out (report folder), --osm-file (a JSON list of
// {id, lat, lng, tags} to use instead of asking OpenStreetMap), --checked (the list of hand-placed pins). Run by .github/workflows/positions.yml.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPublic, isPublicPlay } from './osm-details.mjs';

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const DIR = arg('--dir', 'src/content/playgrounds');
const OUT = arg('--out', 'reports');
const REGION = arg('--region', '');
const OSM_FILE = arg('--osm-file', process.env.OSM_PLAYGROUNDS ?? ''); // the monthly snapshot, when a workflow has fetched it
const TEST_FILE = process.argv.includes('--osm-file');
const INCLUDE = new Set(arg('--include', 'unrecorded,approximate,postcode').split(',').map((s) => s.trim()));
const FIX = process.argv.includes('--fix');
const CHECKED_FILE = arg('--checked', 'src/data/pins-checked.json');
const ON_M = Number(arg('--on', 60)); // a mapped playground this close means the pin is right
const MAX_M = Number(arg('--max', 500)); // never look, or move a pin, further than this
const NAME_BONUS_M = 150; // matching names count as this much closer
const CLEAR_M = 80; // a second choice within this much of the best one makes the match ambiguous
const UNNAMED_M = 250; // beyond this, only move a pin onto a match whose name shares a word with it
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; checks playground pins against OpenStreetMap)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const metres = (a, b) => km(a, b) * 1000;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Where a pin came from, judged by what the playground file says about it. */
function provenance(p) {
  const nc = p.notConfirmed ?? '';
  const src = (p.sources ?? []).map((s) => s.url).join(' ');
  if (/taken from OpenStreetMap/i.test(nc) || /openstreetmap\.org/.test(src)) return 'osm';
  if (/council.s map/i.test(nc)) return 'council-map';
  if (/mapped from the postcode/i.test(nc)) return 'postcode';
  if (/approximate/i.test(nc)) return 'approximate';
  return 'unrecorded';
}

// The same test as the coverage check: leave out private and indoor ones, and ones at schools, pubs, hotels and so on.

const GENERIC = new Set(['play', 'area', 'areas', 'playground', 'playgrounds', 'park', 'parks', 'recreation', 'rec', 'ground', 'grounds', 'playing', 'field', 'fields', 'junior', 'toddler', 'toddlers', 'infant', 'the', 'and', 'of', 'off', 'road', 'street', 'close', 'avenue', 'lane', 'drive', 'way', 'gardens', 'green', 'common', 'country', 'natural', 'adventure', 'splash', 'pad']);
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w));
const sharesName = (pin, osm) => {
  const a = new Set([...words(pin.name), ...words(pin.area)]);
  return words(`${osm.tags.name ?? ''} ${osm.tags.operator ?? ''}`).some((w) => a.has(w));
};

async function overpass(query) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: 'POST', headers: UA, body: new URLSearchParams({ data: query }) });
      if (r.ok) return (await r.json()).elements;
      console.log(`  Overpass answered ${r.status}, trying again`);
    } catch (e) {
      console.log(`  Overpass failed (${e.message}), trying again`);
    }
    await sleep(20000);
  }
  return null;
}

// 1. The playground files, and which pins to check.
const all = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const doc = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  all.push({ id: f.replace(/\.json$/, ''), file: join(DIR, f), doc, lat: doc.lat, lng: doc.lng, name: doc.name, area: doc.area, region: doc.region, from: provenance(doc) });
}
const count = {};
all.forEach((p) => (count[p.from] = (count[p.from] ?? 0) + 1));
console.log(`Pins by source: ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(', ')}`);
const handPlaced = new Set(
  (await readFile(CHECKED_FILE, 'utf8').then(JSON.parse).catch(() => ({ pins: [] }))).pins.map((p) => p.id),
);
if (handPlaced.size) console.log(`Leaving out ${handPlaced.size} pins placed by hand (${CHECKED_FILE})`);
const pins = all.filter((p) => !handPlaced.has(p.id) && INCLUDE.has(p.from) && (!REGION || p.region === REGION) && Number.isFinite(p.lat) && Number.isFinite(p.lng));
console.log(`Checking ${pins.length} pins (${[...INCLUDE].join(', ')}${REGION ? `, ${REGION} only` : ''})`);

// 2. Public playgrounds on OpenStreetMap around those pins, asked for in 0.1 degree squares.
let osm = [];
if (OSM_FILE) {
  osm = JSON.parse(await readFile(OSM_FILE, 'utf8')).filter((e) => isPublicPlay(e)).map((e) => ({ ...e, tags: e.tags ?? {} }));
} else {
  const pad = 0.007; // a little over MAX_M, in degrees
  const cells = new Map();
  for (const p of pins) cells.set(`${Math.floor(p.lat * 10)},${Math.floor(p.lng * 10)}`, [Math.floor(p.lat * 10), Math.floor(p.lng * 10)]);
  const boxes = [...cells.values()].map(([a, b]) => `(${(a / 10 - pad).toFixed(4)},${(b / 10 - pad).toFixed(4)},${((a + 1) / 10 + pad).toFixed(4)},${((b + 1) / 10 + pad).toFixed(4)})`);
  const seen = new Map();
  for (let i = 0; i < boxes.length; i += 25) {
    const batch = boxes.slice(i, i + 25);
    console.log(`  OpenStreetMap, squares ${i + 1}-${i + batch.length} of ${boxes.length}`);
    const els = await overpass(`[out:json][timeout:180];(${batch.map((b) => `nwr[leisure=playground]${b};`).join('')});out center tags;`);
    if (!els) throw new Error('OpenStreetMap could not be reached, so nothing was checked. Try again later.');
    for (const e of els) {
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      if (lat != null && lng != null && isPublic(e.tags ?? {})) seen.set(`${e.type}/${e.id}`, { id: `${e.type}/${e.id}`, lat, lng, tags: e.tags ?? {} });
    }
    await sleep(2000);
  }
  osm = [...seen.values()];
}
console.log(`${osm.length} public playgrounds on OpenStreetMap near those pins`);

// 3. Match pins to mapped playgrounds one to one, best match first.
const grid = new Map();
const cell = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
for (const o of osm) grid.set(cell(o.lat, o.lng), [...(grid.get(cell(o.lat, o.lng)) ?? []), o]);
const near = (p) => {
  const out = [];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const o of grid.get(`${Math.floor(p.lat * 100) + a},${Math.floor(p.lng * 100) + b}`) ?? []) {
        const d = metres(p, o);
        if (d <= MAX_M) out.push({ o, d, eff: d - (sharesName(p, o) ? NAME_BONUS_M : 0) });
      }
  return out.sort((x, y) => x.eff - y.eff);
};
const options = new Map(pins.map((p) => [p.id, near(p)]));
const pairs = pins.flatMap((p) => options.get(p.id).map((c) => ({ p, ...c }))).sort((a, b) => a.eff - b.eff);
const taken = new Set();
const matched = new Map();
for (const c of pairs) {
  if (matched.has(c.p.id) || taken.has(c.o.id)) continue;
  matched.set(c.p.id, c);
  taken.add(c.o.id);
}

const results = pins.map((p) => {
  const opts = options.get(p.id);
  const m = matched.get(p.id);
  const base = { id: p.id, name: p.name, area: p.area, region: p.region, from: p.from, lat: p.lat, lng: p.lng };
  if (!opts.length) return { ...base, status: 'far' };
  if (!m) return { ...base, status: 'unmatched', candidates: opts.slice(0, 3).map((c) => ({ osm: c.o.id, name: c.o.tags.name ?? null, metres: Math.round(c.d), lat: round5(c.o.lat), lng: round5(c.o.lng) })) };
  if (m.d <= ON_M) {
    // On a mapped playground, but one whose name has nothing in common with ours: a person should look.
    if (m.o.tags.name && !sharesName(p, m.o)) return { ...base, status: 'name', osm: m.o.id, osmName: m.o.tags.name, metres: Math.round(m.d) };
    return { ...base, status: 'confirmed', osm: m.o.id, metres: Math.round(m.d) };
  }
  const others = opts.filter((c) => c.o.id !== m.o.id && c.eff < m.eff + CLEAR_M);
  const unsure = m.d > UNNAMED_M && !sharesName(p, m.o);
  if (others.length || unsure)
    return { ...base, status: 'ambiguous', candidates: [m, ...others].slice(0, 4).map((c) => ({ osm: c.o.id, name: c.o.tags.name ?? null, metres: Math.round(c.d), lat: round5(c.o.lat), lng: round5(c.o.lng) })) };
  return { ...base, status: 'move', osm: m.o.id, osmName: m.o.tags.name ?? null, metres: Math.round(m.d), to: { lat: round5(m.o.lat), lng: round5(m.o.lng) } };
});

// 3b. The nearest named street to each mapped playground a person has to choose between, so it can be matched to
// council names like "Linacre Road" or "off Storforth Lane". Skipped with --osm-file (tests) or --no-streets; still
// asked live when the playgrounds come from the snapshot, since it's only a few small queries.
const needStreet = results.flatMap((r) => (['ambiguous', 'unmatched'].includes(r.status) ? r.candidates : []).filter((c) => c.lat != null));
if (!TEST_FILE && !process.argv.includes('--no-streets') && needStreet.length) {
  const uniq = [...new Map(needStreet.map((c) => [c.osm, c])).values()];
  const ways = [];
  for (let i = 0; i < uniq.length; i += 60) {
    const batch = uniq.slice(i, i + 60);
    console.log(`  Street names, playgrounds ${i + 1}-${i + batch.length} of ${uniq.length}`);
    const els = await overpass(`[out:json][timeout:180];(${batch.map((c) => `way(around:120,${c.lat},${c.lng})[highway][name];`).join('')});out tags geom;`);
    if (els) ways.push(...els.filter((e) => e.geometry));
    await sleep(2000);
  }
  for (const c of needStreet) {
    let best = null;
    for (const w of ways)
      for (const g of w.geometry) {
        const d = metres(c, { lat: g.lat, lng: g.lon });
        if (d <= 120 && (!best || d < best.d)) best = { d, name: w.tags.name };
      }
    if (best) c.street = best.name;
  }
}

// 4. Move the clear ones.
let moved = 0;
if (FIX) {
  for (const r of results.filter((x) => x.status === 'move')) {
    const p = pins.find((x) => x.id === r.id);
    p.doc.lat = r.to.lat;
    p.doc.lng = r.to.lng;
    const nc = p.doc.notConfirmed ?? '';
    const said = 'Exact position (taken from OpenStreetMap)';
    p.doc.notConfirmed = !nc
      ? `${said}, age ranges, play equipment, opening hours, toilets and parking.`
      : /^Exact position/i.test(nc)
        ? nc.replace(/^Exact position(\s*\([^)]*\))?/i, said)
        : `${said}. ${nc}`;
    await writeFile(p.file, JSON.stringify(p.doc, null, 2) + '\n');
    r.moved = true;
    moved++;
  }
}

// 5. The report.
const statuses = ['confirmed', 'move', 'ambiguous', 'unmatched', 'far', 'name'];
const regions = [...new Set(results.map((r) => r.region))].sort();
const link = (id) => `[${id}](https://www.openstreetmap.org/${id})`;
const lines = [
  '# Swing By pin positions',
  '',
  `Checked ${new Date().toISOString().slice(0, 10)} against playgrounds mapped on OpenStreetMap (© OpenStreetMap contributors). Pins checked: those whose position came from ${[...INCLUDE].join(', ')}. A pin counts as right if a mapped playground is within ${ON_M} m.`,
  '',
  `| Region | Checked | ${statuses.join(' | ')} |`,
  `| --- | ---: | ${statuses.map(() => '---:').join(' | ')} |`,
  ...regions.map((r) => {
    const rs = results.filter((x) => x.region === r);
    return `| ${r} | ${rs.length} | ${statuses.map((s) => rs.filter((x) => x.status === s).length).join(' | ')} |`;
  }),
  `| **All** | **${results.length}** | ${statuses.map((s) => `**${results.filter((x) => x.status === s).length}**`).join(' | ')} |`,
  '',
  FIX ? `Moved ${moved} pins onto the playground mapped on OpenStreetMap.` : 'Report only: run with --fix (or tick "Move the clear ones" in the workflow) to move the pins marked "move".',
];
const section = (title, note, rows, head, row) => {
  if (!rows.length) return;
  lines.push('', `## ${title} (${rows.length})`, '', note, '', head[0], head[1], ...rows.map(row));
};
section('Moves', FIX ? 'These pins were moved.' : 'These pins would be moved.', results.filter((r) => r.status === 'move'),
  ['| Playground | Region | Was | Now | Metres | OpenStreetMap |', '| --- | --- | --- | --- | ---: | --- |'],
  (r) => `| ${r.name} (${r.area}) | ${r.region} | ${r.lat}, ${r.lng} | ${r.to.lat}, ${r.to.lng} | ${r.metres} | ${link(r.osm)}${r.osmName ? ` ${r.osmName}` : ''} |`);
section('Ambiguous', 'More than one mapped playground could be this one. Pick the right one by hand; these are never moved automatically.', results.filter((r) => r.status === 'ambiguous'),
  ['| Playground | Region | Pin | Could be |', '| --- | --- | --- | --- |'],
  (r) => `| ${r.name} (${r.area}) | ${r.region} | ${r.lat}, ${r.lng} | ${r.candidates.map((c) => `${link(c.osm)} ${c.name ?? ''} ${c.metres} m${c.street ? ` (by ${c.street})` : ''}`).join('; ')} |`);
section('Unmatched', 'The mapped playgrounds near these pins are already used by other pins, so this one may be stacked on another. Look at each by hand.', results.filter((r) => r.status === 'unmatched'),
  ['| Playground | Region | Pin | Nearest mapped, already used |', '| --- | --- | --- | --- |'],
  (r) => `| ${r.name} (${r.area}) | ${r.region} | ${r.lat}, ${r.lng} | ${r.candidates.map((c) => `${link(c.osm)} ${c.metres} m${c.street ? ` (by ${c.street})` : ''}`).join('; ')} |`);
section('Far from any mapped playground', `Nothing is mapped on OpenStreetMap within ${MAX_M} m. Either the pin is badly out or the playground isn't mapped yet. Check by hand, or add it to OpenStreetMap.`, results.filter((r) => r.status === 'far'),
  ['| Playground | Region | Pin | Source of pin |', '| --- | --- | --- | --- |'],
  (r) => `| ${r.name} (${r.area}) | ${r.region} | ${r.lat}, ${r.lng} | ${r.from} |`);
section('Name doesn\'t match', "These pins sit on a mapped playground whose name shares no word with ours, so it may be a different playground. Check each by hand; they are never moved automatically. Once a pin is right, add it to src/data/pins-checked.json.", results.filter((r) => r.status === 'name'),
  ['| Playground | Region | Pin | Mapped playground there | Source of pin |', '| --- | --- | --- | --- | --- |'],
  (r) => `| ${r.name} (${r.area}) | ${r.region} | ${r.lat}, ${r.lng} | ${link(r.osm)} ${r.osmName} | ${r.from} |`);

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'positions.md'), lines.join('\n') + '\n');
await writeFile(join(OUT, 'positions.json'), JSON.stringify(results, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(statuses.map((s) => `${s} ${results.filter((x) => x.status === s).length}`).join(', ') + (FIX ? `; moved ${moved}` : ''));

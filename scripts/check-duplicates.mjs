// Possible duplicate playgrounds: pairs of listings that may be the same place, for the daily "Fix check reports" task
// (docs/fixing-check-reports.md) to merge with scripts/merge-playgrounds.mjs or mark as separate. Changes no files.
//
// Uses the same rules as the coverage check (scripts/same-place.mjs), so a pin from a postcode, street or park's
// middle reaches 300 m when the names agree. Pairs someone has already looked at and found to be separate places are
// in src/data/not-duplicates.json and never reported again.
//
//   node scripts/check-duplicates.mjs [--out reports] [--dir src/content/playgrounds]
// Writes <out>/duplicates.md (the issue, at most 40 per section) and <out>/duplicates.json (every pair), and prints
// how many it found.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOSE_M, ROUGH_M, SAME_M, madeUpName, nameWords, namesAgree, osmIds, reachM, roughPin } from './same-place.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const DIR = arg('--dir', 'src/content/playgrounds');
const OUT = arg('--out', 'reports');
const NOT_FILE = arg('--not', 'src/data/not-duplicates.json');
const SHOW = 40;

export const pairKey = (a, b) => [a, b].sort().join(' + ');

/** Distance in metres. */
export function metres(a, b) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** A listing file's fields that matter here. */
export function listing(id, d) {
  const osmOnly = !d.checked && (d.sources ?? []).length > 0 && d.sources.every((s) => /openstreetmap\.org\//.test(s.url));
  return { id, name: d.name, area: d.area, lat: d.lat, lng: d.lng, osmOnly, osm: osmIds(d.sources), rough: roughPin(d.notConfirmed) };
}

// Words that tell apart separate play areas in one park ("Jubilee Park Infant Play Area", "… Junior Play Area").
const PART = /^(?:[a-z]|\d+|no|infant|infants|junior|juniors|toddler|toddlers|tots|main|older|younger|teen|teens|youth|senior|big|little|small|large|upper|lower|north|south|east|west|new|old|skate|muga|wheeled|sports|zip|wire|splash|water|natural|nature|equipped|multi|use|games|pavilion|adventure|1st|2nd|one|two|three)$/;
const words = (s) => String(s ?? '').toLowerCase().split(',')[0].replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// Street words: "Bell Close" and "Swallow Close" aren't alike. Welsh "ardal chwarae" is "play area".
const STREET = new Set('close road drive view mead court avenue street lane way crescent place square rise grove terrace walk gardens green row hill end park ardal chwarae'.split(' '));
const keyWords = (s) => nameWords(String(s).split(',')[0]).filter((w) => !STREET.has(w));
/** Two names that share a distinctive word but aren't just two parts of one park. */
const shareWord = (x, y) => {
  if (madeUpName(x) || madeUpName(y)) return false;
  const a = new Set(keyWords(x));
  if (!keyWords(y).some((w) => a.has(w))) return false;
  return !partsOfOnePark(x, y);
};
/** Names that differ by a part word: two play areas in one park, not one listed twice. */
function partsOfOnePark(x, y) {
  const wx = new Set(words(x)), wy = new Set(words(y));
  const diff = [...wx].filter((w) => !wy.has(w)).concat([...wy].filter((w) => !wx.has(w)));
  return diff.length > 0 && diff.some((w) => PART.test(w));
}

/**
 * What kind of possible duplicate two listings are, or null if they're clearly separate. Kinds, most likely first:
 * - 'same-osm': both cite the same OpenStreetMap playground.
 * - 'osm-beside-official': an OpenStreetMap-only listing next to an official one (what the coverage check would now
 *   treat as the same place).
 * - 'similar-names': two listings close together sharing a distinctive word of their names.
 * - 'shared-pin': on the same spot (under 5 m) with different names: usually two playgrounds given one postcode's pin,
 *   so the fix is a pin, not a merge.
 * - 'very-close': under 40 m apart with different names: usually two sites side by side, but worth a look.
 */
export function kindOf(a, b, d) {
  if (a.osm.some((x) => b.osm.includes(x))) return 'same-osm';
  if (d >= reachM(a, b)) return null;
  if (a.osmOnly !== b.osmOnly) {
    const [osm, off] = a.osmOnly ? [a, b] : [b, a];
    if (d < SAME_M || namesAgree(osm.name, off.name)) return 'osm-beside-official';
    return null;
  }
  // Two OpenStreetMap-only listings are two playgrounds mapped separately, so only very close ones are worth a look
  // (the same playground mapped twice, once as a point and once as an outline).
  if (a.osmOnly && b.osmOnly) return d < CLOSE_M ? (a.name === b.name ? 'similar-names' : 'very-close') : null;
  if (shareWord(a.name, b.name) || (a.name === b.name)) return 'similar-names';
  if (d < 5) return partsOfOnePark(a.name, b.name) ? null : 'shared-pin';
  if (d < CLOSE_M) return 'very-close';
  return null;
}

export const KINDS = {
  'same-osm': 'Both cite the same OpenStreetMap playground',
  'osm-beside-official': 'OpenStreetMap-only listing beside an official one',
  'similar-names': 'Similar names close together',
  'very-close': 'Under 40 m apart, different names (often two sites side by side)',
  'shared-pin': 'Different playgrounds on one pin (usually a shared postcode: fix the pins, not a merge)',
};

/** Every possible duplicate pair among listings, skipping keys in notDup. */
export function findPairs(all, notDup = new Set()) {
  const grid = new Map();
  const cell = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 60)}`; // about 1.1 km, more than 300 m
  for (const p of all) grid.set(cell(p.lat, p.lng), [...(grid.get(cell(p.lat, p.lng)) ?? []), p]);
  const byOsm = new Map();
  for (const p of all) for (const o of p.osm) byOsm.set(o, [...(byOsm.get(o) ?? []), p]);
  const seen = new Set();
  const pairs = [];
  const consider = (a, b) => {
    if (a.id === b.id) return;
    const key = pairKey(a.id, b.id);
    if (seen.has(key) || notDup.has(key)) return;
    seen.add(key);
    const d = metres(a, b);
    const kind = kindOf(a, b, d);
    if (kind) pairs.push({ kind, m: Math.round(d), a: a.id, b: b.id, names: [a.name, b.name], area: a.area });
  };
  for (const p of all) {
    const [y, x] = cell(p.lat, p.lng).split(',').map(Number);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get(`${y + i},${x + j}`) ?? []) if (metres(p, q) < ROUGH_M) consider(p, q);
  }
  for (const ps of byOsm.values()) for (const p of ps) for (const q of ps) consider(p, q);
  const order = Object.keys(KINDS);
  return pairs.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || x.m - y.m || x.a.localeCompare(y.a));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = [];
  for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    if (typeof d.lat === 'number' && typeof d.lng === 'number') all.push(listing(f.replace(/\.json$/, ''), d));
  }
  const not = JSON.parse(await readFile(NOT_FILE, 'utf8').catch(() => '{"pairs":[]}'));
  const notDup = new Set((not.pairs ?? []).map((p) => pairKey(p.a, p.b)));
  const pairs = findPairs(all, notDup);

  const site = 'https://swing-by.co.uk/playgrounds/';
  const lines = [
    '# Possible duplicate playgrounds',
    '',
    `Checked ${new Date().toISOString().slice(0, 10)}: ${all.length} playgrounds, ${pairs.length} pairs that may be the same place. Nothing has been changed.`,
    '',
    `Pairs are within ${SAME_M} m, or ${ROUGH_M} m where a pin is only approximate (postcode, street or park's middle) and the names agree; see \`scripts/same-place.mjs\`. Pairs already found to be separate are in \`src/data/not-duplicates.json\`. How to deal with each kind: \`docs/fixing-check-reports.md\`.`,
  ];
  for (const [kind, title] of Object.entries(KINDS)) {
    const these = pairs.filter((p) => p.kind === kind);
    if (!these.length) continue;
    lines.push('', `## ${title} (${these.length})`, '');
    for (const p of these.slice(0, SHOW)) lines.push(`- ${p.m} m: [${p.names[0]}](${site}${p.a}/) (\`${p.a}\`) and [${p.names[1]}](${site}${p.b}/) (\`${p.b}\`)`);
    if (these.length > SHOW) lines.push(`- …and ${these.length - SHOW} more in the duplicates artifact.`);
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'duplicates.md'), lines.join('\n') + '\n');
  await writeFile(join(OUT, 'duplicates.json'), JSON.stringify(pairs, null, 1) + '\n');
  console.log(`${pairs.length} possible duplicate pairs`);
  for (const kind of Object.keys(KINDS)) console.log(`  ${kind}: ${pairs.filter((p) => p.kind === kind).length}`);
}

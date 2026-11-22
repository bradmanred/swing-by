// How many playgrounds have a size, and which councils to check for sizes next (docs/finding-playgrounds.md, 'size').
// Groups every playground by its local authority (postcodes.io, as the coverage check does), then lists:
//   - councils not yet in src/data/size-sources.json, most playgrounds first;
//   - councils recorded as grading their play areas where none of our playgrounds has a size yet (recorded, but the
//     sizes were never applied; some councils grade only some sites, so a partly graded council isn't listed);
//   - councils recorded as 'none' whose check is over two years old.
// Writes reports/sizes.md and reports/sizes.json ({ total, graded, percent, threshold, todo, behind, stale }).
// Changes nothing. The weekly "Check sizes" workflow opens the report as a check-report issue, and a separate issue
// once graded playgrounds pass THRESHOLD percent, when the home page's size filter can come back (SHOW_SIZES in
// src/pages/index.astro).
//
//   node scripts/size-gaps.mjs [--out reports]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const THRESHOLD = 10;
const DIR = 'src/content/playgrounds';
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'reports';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; checks which councils grade play area sizes)' };
const TODAY = new Date().toISOString().slice(0, 10);
const LIST = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/\b(city of|county of|borough of|council|district|borough|metropolitan|city|county|royal)\b/g, '').replace(/[^a-z]+/g, ' ').trim();

/** The local authority for each point, from postcodes.io, 100 at a time ('Unknown council' when none is near). */
async function districts(points) {
  const res = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    let j = null;
    for (let t = 0; t < 3 && !j; t++) {
      j = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 2000, limit: 1 })) }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!j) await sleep(5000);
    }
    res.push(...(j?.result ?? chunk.map(() => null)).map((x) => x?.result?.[0]?.admin_district ?? 'Unknown council'));
  }
  return res;
}

const parks = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  parks.push({ id: f.replace(/\.json$/, ''), lat: d.lat, lng: d.lng, size: d.size ?? null });
}
const total = parks.length;
const graded = parks.filter((p) => p.size).length;
const percent = total ? Math.round((graded / total) * 1000) / 10 : 0;

const recorded = JSON.parse(await readFile('src/data/size-sources.json', 'utf8')).councils;
const recordFor = (district) => recorded.find((c) => norm(c.district) === norm(district));

const names = await districts(parks);
// postcodes.io down or unreachable: say so rather than report every council as unchecked.
if (names.filter((n) => n === 'Unknown council').length > total / 2) throw new Error('Most playgrounds could not be matched to a council (is postcodes.io reachable?)');
const groups = new Map();
parks.forEach((p, i) => {
  const g = groups.get(names[i]) ?? { district: names[i], playgrounds: 0, graded: 0 };
  g.playgrounds++;
  if (p.size) g.graded++;
  groups.set(names[i], g);
});
const all = [...groups.values()].filter((g) => g.district !== 'Unknown council').sort((a, b) => b.playgrounds - a.playgrounds || a.district.localeCompare(b.district));
const twoYearsAgo = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
const todo = all.filter((g) => !recordFor(g.district));
const behind = all.filter((g) => ['fit', 'own'].includes(recordFor(g.district)?.grading) && g.graded === 0);
const stale = all.filter((g) => recordFor(g.district)?.grading === 'none' && (recordFor(g.district).checked ?? '') < twoYearsAgo);

const search = (d) => `https://duckduckgo.com/?q=${encodeURIComponent(`${d} council play area LEAP OR NEAP OR "play strategy"`)}`;
const lines = [
  '# Playground sizes',
  '',
  `Checked ${TODAY}. **${graded} of ${total} playgrounds (${percent}%) have a size** from their council's grading. The home page's size filter is hidden until this passes ${THRESHOLD}%.`,
  '',
  'Work through these following the "Playground sizes" section of docs/fixing-check-reports.md: find the council\'s grading, set `size` on its playgrounds, and record the council in src/data/size-sources.json (with `"grading": "none"` if it doesn\'t publish sizes).',
  '',
  '## Councils not checked yet',
  '',
  'Most playgrounds first.',
  '',
  '| Council | Playgrounds | Look for sizes |',
  '| --- | ---: | --- |',
  ...todo.slice(0, LIST).map((g) => `| ${g.district} | ${g.playgrounds} | [search](${search(g.district)}) |`),
  ...(todo.length > LIST ? ['', `…and ${todo.length - LIST} more councils.`] : []),
];
if (behind.length)
  lines.push('', '## Councils recorded as grading, but none of our playgrounds has a size', '', 'Their sources are in src/data/size-sources.json: apply the sizes to their playgrounds.', '', '| Council | Playgrounds | With a size |', '| --- | ---: | ---: |', ...behind.map((g) => `| ${g.district} | ${g.playgrounds} | ${g.graded} |`));
if (stale.length)
  lines.push('', '## Checked over two years ago and found no sizes', '', 'Worth another look: councils publish new play strategies.', '', '| Council | Playgrounds | Checked |', '| --- | ---: | --- |', ...stale.map((g) => `| ${g.district} | ${g.playgrounds} | ${recordFor(g.district).checked ?? ''} |`));

await mkdir(out, { recursive: true });
await writeFile(join(out, 'sizes.md'), lines.join('\n') + '\n');
await writeFile(join(out, 'sizes.json'), JSON.stringify({ date: TODAY, total, graded, percent, threshold: THRESHOLD, todo, behind, stale }, null, 1) + '\n');
console.log(`${graded} of ${total} playgrounds (${percent}%) have a size. ${todo.length} councils to check, ${behind.length} behind, ${stale.length} due a recheck.`);

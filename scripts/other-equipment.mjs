// Weekly tick-box review for the "What did you see?" picker on playground pages.
//
// Looks at two things and writes a Markdown report of what could become a new tick box:
//   1. What parents typed into "Something else?" (from /api/equipment/other, which needs the moderator key).
//      Each household counts once, and what counts most is how many different playgrounds a thing was seen at.
//   2. How often common play equipment is mentioned in our playground descriptions, which come from council and
//      operator websites. Something that's in lots of descriptions but isn't a tick box is a gap too.
//
//   SITE=https://swing-by.co.uk MOD_TOKEN=… node scripts/other-equipment.mjs [--out report.md]
//
// Run weekly by .github/workflows/tick-box-review.yml, which posts the report to the "Weekly tick-box review" issue
// and then runs scripts/tick-box-apply.mjs to add the new tick boxes it can.
// Without MOD_TOKEN it reports on playground descriptions only.
//
// Adding a tick box: give it a short code in src/data/labels.json (equipment, access or facilities), an icon in
// ICON in src/lib/parks.ts, and an option in public/admin/config.yml. The picker sorts itself.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITE = process.env.SITE || 'https://swing-by.co.uk';
const TOKEN = process.env.MOD_TOKEN;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const OUT = arg('--out');
// --json writes the suggestions for scripts/tick-box-apply.mjs, which adds the ones it can without a person.
const JSON_OUT = arg('--json');
// Suggest a new tick box once a typed-in thing has been seen at this many playgrounds by this many households,
// or is mentioned in this many playground descriptions.
const MIN_PARKS = 3;
const MIN_PARENTS = 3;
const MIN_DESCRIPTIONS = 25;

// Common UK play equipment and the words councils use for it. Matched against playground descriptions.
const WATCH = {
  'Springers': ['springer', 'spring rocker', 'spring animal', 'spring rider'],
  'Rocking horse': ['rocking horse'],
  'Basket or nest swing': ['basket swing', 'nest swing', 'group swing', 'bird nest swing'],
  'Tyre swing': ['tyre swing'],
  'Outdoor gym': ['outdoor gym', 'fitness equipment', 'outdoor fitness', 'gym equipment'],
  'Trim trail': ['trim trail', 'fitness trail'],
  'Ball court': ['ball court', 'muga', 'multi-use games', 'multi use games', 'basketball', 'football goal', 'kickabout'],
  'Table tennis': ['table tennis', 'ping pong'],
  'Climbing wall': ['climbing wall', 'bouldering'],
  'Balance beam': ['balance beam', 'stepping stones', 'balance trail'],
  // Not 'carousel': councils use it for roundabouts and carousel swings. The pattern skips the street "Spinners Way".
  'Spinner': [/\bspinners?\b(?! way)/i, 'spinning cup', 'spinning bowl', 'spinning dish', 'spinning disc', 'spinning pole'],
  'Embankment slide': ['embankment slide', 'hill slide'],
  'Wobbly bridge': ['wobbly bridge', 'rope bridge', 'suspension bridge'],
  'Tunnel': ['tunnel', 'crawl tube'],
  'Play house': ['play house', 'playhouse', 'wendy house'],
  'Pirate ship': ['pirate ship'],
  'Musical play': ['musical', 'chimes', 'drums', 'xylophone'],
  'Sensory panels': ['sensory panel', 'activity panel', 'talk tube'],
  'Picnic tables': ['picnic table', 'picnic bench', 'picnic area'],
  'Cableway': ['cableway', 'cable ride'],
  'Bike track': ['bike track', 'pump track', 'bmx'],
  'Teen shelter': ['teen shelter', 'youth shelter'],
};

const labels = JSON.parse(await readFile('src/data/labels.json', 'utf8'));
const ticks = { ...labels.equipment, ...labels.access, ...labels.facilities };
const tickNames = Object.values(ticks).map((n) => n.toLowerCase());

const dir = 'src/content/playgrounds';
const parks = [];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
  const p = JSON.parse(await readFile(join(dir, f), 'utf8'));
  parks.push({ id: f.replace(/\.json$/, ''), text: `${p.description ?? ''} ${p.notConfirmed ?? ''}`.toLowerCase(), has: [...(p.equipment ?? []), ...(p.access ?? []), ...(p.facilities ?? [])] });
}
const mentions = (words) => parks.filter((p) => words.some((w) => (w instanceof RegExp ? w : new RegExp(`\\b${w.replace(/[^a-z0-9 ]/g, '.')}`, 'i')).test(p.text))).length;
// Is this already a tick box? Matches the name loosely, so "zip wires" is the "Zip wire" tick box.
const isTick = (name, words = []) =>
  [name, ...words.filter((w) => typeof w === 'string')].some((w) => {
    const n = w.toLowerCase().replace(/s$/, '');
    return tickNames.some((t) => t.replace(/s$/, '') === n || (words.includes(w) && t.includes(n)));
  });

let typed = null;
if (TOKEN) {
  const r = await fetch(`${SITE}/api/equipment/other`, { headers: { Authorization: `Bearer ${TOKEN}` } }).catch(() => null);
  if (r?.ok) typed = (await r.json()).other;
  else console.error(`Couldn't read what parents typed in (${r?.status ?? 'no connection'}). Reporting on descriptions only.`);
}

const lines = [];
const today = new Date().toISOString().slice(0, 10);
lines.push(`Tick-box review, ${today}. Current tick boxes: ${Object.values(ticks).join(', ')}.`, '');

const suggest = [];
const found = []; // the same suggestions as data: { name, from: 'typed' | 'descriptions', count }
lines.push('## What parents typed into "Something else?"', '');
if (!typed) lines.push('_Not available this week (no moderator key, or the site could not be reached)._', '');
else if (!typed.length) lines.push('_Nothing typed in yet._', '');
else {
  lines.push('| Typed in | Playgrounds | Households | Also in descriptions |', '| --- | ---: | ---: | ---: |');
  for (const o of typed.slice(0, 40)) {
    const desc = mentions([o.key]);
    const ok = o.parks.length >= MIN_PARKS && o.parents >= MIN_PARENTS;
    if (ok) {
      suggest.push(`**${o.text}**: seen at ${o.parks.length} playgrounds by ${o.parents} households, and in ${desc} descriptions`);
      found.push({ name: o.text, from: 'typed', count: o.parks.length, households: o.parents });
    }
    lines.push(`| ${o.text.replace(/\|/g, '/')}${ok ? ' ⭐' : ''} | ${o.parks.length} | ${o.parents} | ${desc} |`);
  }
  lines.push('');
}

lines.push('## Common equipment in playground descriptions', '');
lines.push('| Equipment | Descriptions mentioning it | Already a tick box? |', '| --- | ---: | --- |');
const rows = Object.entries(WATCH)
  .map(([name, words]) => ({ name, n: mentions(words), tick: isTick(name, words) }))
  .sort((a, b) => b.n - a.n);
for (const r of rows) {
  if (!r.tick && r.n >= MIN_DESCRIPTIONS) {
    suggest.push(`**${r.name}**: mentioned in ${r.n} playground descriptions`);
    found.push({ name: r.name, from: 'descriptions', count: r.n });
  }
  lines.push(`| ${r.name}${!r.tick && r.n >= MIN_DESCRIPTIONS ? ' ⭐' : ''} | ${r.n} | ${r.tick ? 'Yes' : 'No'} |`);
}
lines.push('');

const used = Object.fromEntries(Object.keys(ticks).map((k) => [k, parks.filter((p) => p.has.includes(k)).length]));
lines.push('## How often each tick box is used in playground files', '');
lines.push(Object.entries(used).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${ticks[k]} ${n}`).join(' · '), '');

const head = [
  `# Suggested new tick boxes`,
  '',
  suggest.length ? suggest.map((s) => `- ${s}`).join('\n') : '_Nothing new this week: the tick list covers what parents and councils mention most._',
  '',
  `Rule of thumb: suggest a tick box once something typed in has been seen at ${MIN_PARKS}+ playgrounds by ${MIN_PARENTS}+ households, or appears in ${MIN_DESCRIPTIONS}+ descriptions. Group near-duplicates, but only when they really are the same thing: a rocking horse on a rocking base isn't a springer. Don't add toilets or baby change: those only come from official sources.`,
  '',
];
const report = [...head, ...lines].join('\n');
if (OUT) await writeFile(OUT, report);
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(found, null, 1));
console.log(report);

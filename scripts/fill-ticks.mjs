// Fills in tick boxes from what a playground's description already says, without Claude. Most playgrounds added in
// bulk have no tick boxes, so they never show up when a family uses a filter on the home page ("What do they love?"),
// even when their description says "swings, slides and a zip wire".
//
// For each playground it looks for each piece of equipment's words in the description (which comes from the council,
// operator or OpenStreetMap) and adds the tick box if it isn't there yet. It only ever adds, never removes, and only
// equipment plus "Inclusive equipment" and "Sensory play": never toilets, baby change or other facilities, which come
// from official sources only. A sentence that says something is missing, closed or gone ("no swings", "the zip wire
// has been removed") doesn't count, and road directions don't count for roundabouts. notConfirmed (the list of things
// we don't know) is never read.
//
//   node scripts/fill-ticks.mjs [--dir src/content/playgrounds] [--out reports] [--dry-run]
//
// Run weekly by .github/workflows/fill-ticks.yml, which pushes the changes to main.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Each tick box and the words that mean it. Strings match as whole words (case doesn't matter); patterns as written.
export const RULES = {
  equipment: {
    sw: [/\bswings?\b(?! by)/, 'swing set'],
    bs: ['baby swing', 'baby swings', 'cradle swing', 'cradle swings', 'cradle seat', 'cradle seats', 'toddler swing', 'toddler swings', 'infant swing', 'infant swings', 'baby seat swing'],
    sl: [/\bslides?\b/],
    cl: ['climbing frame', 'climbing frames', 'climbing unit', 'climbing units', 'climbing structure', 'climbing equipment', 'climber', 'climbers', 'climbing net', 'climbing nets', 'multi-play unit', 'multiplay unit', 'multi-play', 'play tower', 'climbing wall', 'climbing'],
    zw: ['zip wire', 'zip wires', 'zipwire', 'zipwires', 'zip line', 'zip-wire', 'aerial runway', 'cableway', 'cable ride', 'flying fox'],
    sp: ['sandpit', 'sandpits', 'sand pit', 'sand pits', 'sand play', 'sandbox'],
    wp: ['water play', 'splash pad', 'splash park', 'splash play', 'water pump', 'archimedes screw', 'paddling pool'],
    ad: ['adventure playground', 'adventure play'],
    rb: [/\broundabouts?\b/, 'merry-go-round', 'merry go round'],
    sk: ['skate park', 'skatepark', 'skate parks', 'skateparks', 'skate ramp', 'skate ramps', 'skate bowl', 'skate area'],
    tp: [/\btrampolines?\b/],
    ss: ['see-saw', 'see-saws', 'seesaw', 'seesaws', 'see saw', 'see saws'],
    mb: ['monkey bars', 'overhead ladder', 'overhead bars', 'monkey rings'],
    spr: [/\bspringers?\b/, 'springies', 'spring rocker', 'spring rockers', 'spring animal', 'spring animals', 'spring rider', 'spring riders', 'spring toys', 'rockers'],
    bk: ['basket swing', 'basket swings', 'nest swing', 'nest swings', 'group swing', 'bird nest swing', 'bird’s nest swing', "bird's nest swing"],
    gym: ['outdoor gym', 'outdoor gyms', 'fitness equipment', 'outdoor fitness', 'gym equipment', 'calisthenics', 'fitness stations'],
    mg: ['ball court', 'muga', 'multi-use games', 'multi use games', 'basketball', 'football goal', 'football goals', 'kickabout', 'games area', 'goal posts', 'goalposts'],
    bb: ['balance beam', 'balance beams', 'stepping stones', 'balance trail', 'balance logs', 'stepping logs', 'stepping posts'],
    bt: ['bike track', 'pump track', 'bmx', 'cycle track'],
    tt: ['table tennis', 'ping pong'],
    spn: [/\bspinners?\b(?! way)/, 'spinning cup', 'spinning cups', 'spinning bowl', 'spinning dish', 'spinning disc', 'spinning pole', 'twister'],
  },
  access: {
    inc: ['inclusive play', 'inclusive equipment', 'inclusive playground', 'inclusive play area', 'wheelchair swing', 'wheelchair accessible roundabout', 'wheelchair roundabout', 'accessible roundabout', 'accessible swing', 'accessible play equipment', 'wheelchair-accessible play'],
    sen: ['sensory play', 'sensory panel', 'sensory panels', 'sensory equipment', 'sensory garden', 'sensory area'],
  },
};
// A sentence saying something isn't there (or isn't any more) doesn't count.
const NEGATIVE = /\b(?:no|not|without|removed|closed|closure|replaced|former|formerly|used to|demolished|out of use|out of order|taken out|missing|except|apart from|isn't|aren't|wasn't|weren't)\b/;
// For roundabouts: a sentence giving road directions doesn't count.
const ROAD = /\b(?:road|junction|exit|turn|traffic|a\d{1,4}|b\d{3,4}|m\d{1,2}|drive past|signposted|car park entrance)\b|\bnear [^.]*roundabout/;

const compile = (w) => (w instanceof RegExp ? new RegExp(w.source, 'i') : new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')}(?![a-z])`, 'i'));
const COMPILED = Object.fromEntries(Object.entries(RULES).map(([g, codes]) => [g, Object.fromEntries(Object.entries(codes).map(([c, ws]) => [c, ws.map(compile)]))]));

/** The tick boxes a description mentions, by group: { equipment: [...], access: [...] }. Pure, for tests. */
export function ticksFrom(description) {
  // The stock text for OpenStreetMap-only playgrounds says nothing about equipment (and names roads: "near Begelly
  // Roundabout"). Their mapped equipment is filled in by the OpenStreetMap tidy job instead.
  if (/^A playground on OpenStreetMap\b/.test(String(description ?? ''))) return { equipment: [], access: [] };
  const sentences = String(description ?? '').toLowerCase().replace(/’/g, "'").split(/(?<=[.!?;])\s+|\n+/);
  const out = { equipment: [], access: [] };
  for (const [g, codes] of Object.entries(COMPILED))
    for (const [c, res] of Object.entries(codes))
      if (sentences.some((s) => !NEGATIVE.test(s) && !(c === 'rb' && ROAD.test(s)) && res.some((re) => re.test(s)))) out[g].push(c);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
  const DIR = arg('--dir', 'src/content/playgrounds');
  const OUT = arg('--out', 'reports');
  const DRY = process.argv.includes('--dry-run');
  const labels = JSON.parse(await readFile('src/data/labels.json', 'utf8'));
  const order = (g) => Object.keys(labels[g]);
  const added = {};
  let files = 0;
  let skipped = 0;
  for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
    const path = join(DIR, f);
    const text = await readFile(path, 'utf8');
    const p = JSON.parse(text);
    const found = ticksFrom(p.description);
    let changed = false;
    for (const g of ['equipment', 'access']) {
      const have = p[g] ?? [];
      const extra = found[g].filter((c) => !have.includes(c));
      if (!extra.length) continue;
      p[g] = [...have, ...extra].sort((a, b) => order(g).indexOf(a) - order(g).indexOf(b));
      for (const c of extra) added[c] = (added[c] ?? 0) + 1;
      changed = true;
    }
    if (!changed) continue;
    // Only rewrite files that are in the usual format, so nothing else in them changes.
    if (JSON.stringify(JSON.parse(text), null, 2) + '\n' !== text) {
      skipped++;
      continue;
    }
    files++;
    if (!DRY) await writeFile(path, JSON.stringify(p, null, 2) + '\n');
  }
  const name = (c) => labels.equipment[c] ?? labels.access[c];
  const L = [
    `# Tick boxes filled in from descriptions, ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${files} playgrounds gained tick boxes${skipped ? ` (${skipped} skipped: file not in the usual format)` : ''}.`,
    '',
    ...Object.entries(added)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `- ${name(c)}: ${n}`),
    '',
  ];
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'fill-ticks.md'), L.join('\n'));
  console.log(L.join('\n'));
}

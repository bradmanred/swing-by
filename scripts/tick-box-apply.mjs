// Adds new tick boxes to the "What did you see?" picker without a person or Claude, from the suggestions the weekly
// tick-box review makes (scripts/other-equipment.mjs --json suggestions.json).
//
// Only equipment that is commonly mentioned in playground descriptions is added automatically, and only things listed
// in KNOWN below, which already has a short code, a UK-English name and an icon for each. Things parents typed into
// "Something else?" are never added automatically (they need a person to judge them: duplicates, rude or personal
// text, things that aren't equipment); they're listed in the report for the owner instead. At most 3 a week.
//
// Each new tick box gets a code and name in src/data/labels.json, an icon in ICON in src/lib/parks.ts and an option in
// public/admin/config.yml (the picker sorts itself). Toilets and baby change are never added: those only come from
// official sources.
//
//   node scripts/tick-box-apply.mjs suggestions.json [--out applied.md] [--root .]
//
// Run every Sunday by .github/workflows/tick-box-review.yml, which builds and tests the site and then pushes to main.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_PER_WEEK = 3;

// Equipment the description count (WATCH in scripts/other-equipment.mjs) can suggest, ready to become a tick box.
// covered: an existing tick box already means the same thing, so it's never added.
export const KNOWN = {
  'Tunnel': { group: 'equipment', code: 'tun', label: 'Tunnel', icon: '🕳️' },
  'Trim trail': { group: 'equipment', code: 'trm', label: 'Trim trail', icon: '🏃' },
  'Musical play': { group: 'equipment', code: 'mus', label: 'Musical play', icon: '🎵' },
  'Climbing wall': { group: 'equipment', code: 'cw', label: 'Climbing wall', icon: '🪨' },
  'Rocking horse': { group: 'equipment', code: 'rh', label: 'Rocking horse', icon: '🏇' },
  'Tyre swing': { group: 'equipment', code: 'tyr', label: 'Tyre swing', icon: '🛞' },
  'Embankment slide': { group: 'equipment', code: 'es', label: 'Embankment slide', icon: '⛰️' },
  'Wobbly bridge': { group: 'equipment', code: 'wb', label: 'Wobbly bridge', icon: '🌉' },
  'Play house': { group: 'equipment', code: 'ph', label: 'Play house', icon: '🏠' },
  'Pirate ship': { group: 'equipment', code: 'ps', label: 'Pirate ship', icon: '⛵' },
  'Sensory panels': { covered: 'Sensory play' },
  'Cableway': { covered: 'Zip wire' },
};

// Adds one tick box to the three files' text. Pure, so tests can run it on made-up copies.
export function addTick({ labels, icons, config }, t) {
  const l = JSON.parse(labels);
  l[t.group] = { ...l[t.group], [t.code]: t.label };
  const labelsOut = JSON.stringify(l, null, 2) + '\n';

  // ICON: a new line before the access icons (for equipment and access) or before the closing brace (facilities).
  const start = icons.indexOf('export const ICON');
  const end = icons.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('ICON not found in src/lib/parks.ts');
  const line = `  ${t.code}: '${t.icon}',\n`;
  const before = t.group === 'facilities' ? end + 1 : icons.indexOf('\n  inc:', start) + 1;
  if (before <= 0 || before > end + 1) throw new Error('Could not find where to put the icon in ICON');
  const iconsOut = icons.slice(0, before) + line + icons.slice(before);

  // Admin options: after the last option of the group's select widget.
  const lines = config.split('\n');
  const at = lines.findIndex((s) => s.trim() === `name: ${t.group}`);
  if (at < 0) throw new Error(`No "name: ${t.group}" field in public/admin/config.yml`);
  let last = -1;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*- \{ label: /.test(lines[i])) last = i;
    else if (last >= 0) break;
    else if (/^\s*- label: /.test(lines[i])) break;
  }
  if (last < 0) throw new Error(`No options found for ${t.group} in public/admin/config.yml`);
  const indent = lines[last].match(/^\s*/)[0];
  lines.splice(last + 1, 0, `${indent}- { label: "${t.label}", value: "${t.code}" }`);
  return { labels: labelsOut, icons: iconsOut, config: lines.join('\n') };
}

// Which suggestions can be added now, which are left for the owner, and why.
export function plan(suggestions, labelsText) {
  const l = JSON.parse(labelsText);
  const codes = new Set(Object.values(l).flatMap((g) => Object.keys(g)));
  const names = new Set(Object.values(l).flatMap((g) => Object.values(g)).map((n) => String(n).toLowerCase()));
  const add = [];
  const owner = [];
  for (const s of [...suggestions].sort((a, b) => b.count - a.count)) {
    if (/toilet|baby ?chang/i.test(s.name)) continue;
    if (s.from === 'typed') {
      owner.push({ ...s, why: 'typed in by parents, so a person should decide' });
      continue;
    }
    const k = KNOWN[s.name];
    if (names.has(s.name.toLowerCase())) continue; // already a tick box
    if (!k) owner.push({ ...s, why: 'no code or icon ready for it in scripts/tick-box-apply.mjs' });
    else if (k.covered) continue;
    else if (codes.has(k.code) || names.has(k.label.toLowerCase())) continue;
    else if (add.length >= MAX_PER_WEEK) owner.push({ ...s, why: `waiting: at most ${MAX_PER_WEEK} new tick boxes a week` });
    else add.push({ ...s, ...k });
  }
  return { add, owner };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
  const ROOT = arg('--root', '.');
  const OUT = arg('--out', null);
  const file = process.argv[2];
  const suggestions = file ? JSON.parse(await readFile(file, 'utf8')) : [];
  const paths = { labels: join(ROOT, 'src/data/labels.json'), icons: join(ROOT, 'src/lib/parks.ts'), config: join(ROOT, 'public/admin/config.yml') };
  let text = { labels: await readFile(paths.labels, 'utf8'), icons: await readFile(paths.icons, 'utf8'), config: await readFile(paths.config, 'utf8') };
  const { add, owner } = plan(suggestions, text.labels);
  for (const t of add) text = addTick(text, t);
  if (add.length) for (const k of Object.keys(paths)) await writeFile(paths[k], text[k]);

  const L = [];
  if (add.length) L.push('**Added as new tick boxes this week** (the site rebuilds from main):', ...add.map((t) => `- ${t.icon} ${t.label} (\`${t.code}\`): mentioned in ${t.count} playground descriptions`), '');
  else L.push('Reviewed: no new tick boxes this week.', '');
  if (owner.length) L.push('**For the owner to decide** (not added automatically):', ...owner.map((s) => `- ${s.name}: ${s.from === 'typed' ? `seen at ${s.count} playgrounds by ${s.households} households` : `in ${s.count} descriptions`} (${s.why})`), '', 'To add one by hand: a code and name in src/data/labels.json, an icon in ICON in src/lib/parks.ts and an option in public/admin/config.yml. Or add it to KNOWN in scripts/tick-box-apply.mjs and the next weekly run adds it.', '');
  const report = L.join('\n');
  if (OUT) await writeFile(OUT, report);
  console.log(report);
}

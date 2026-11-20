// Merge two listings of the same playground, or record two nearby ones as separate places. Used for findings from the
// duplicates check (scripts/check-duplicates.mjs; see docs/fixing-check-reports.md).
//
//   node scripts/merge-playgrounds.mjs <keep> <drop> [--pin keep|drop] [--dry]
//     Keeps <keep>, adds <drop>'s sources and fills in anything <keep> leaves empty from it, deletes <drop>, sends
//     <drop>'s old address to <keep> (MERGED in worker/index.js) and tidies the data files that name <drop>.
//     The pin: by default <drop>'s if <keep>'s is only approximate (postcode, street, park's middle) and <drop>'s
//     isn't, otherwise <keep>'s. --pin chooses. Keep the official listing: merging one into an OpenStreetMap-only
//     listing is refused.
//   node scripts/merge-playgrounds.mjs --separate <a> <b> --note "how you know"
//     Records them in src/data/not-duplicates.json so the duplicates check doesn't report them again.
//
// Parent photos, pin reports and equipment confirmations are stored against a playground's address in the Worker's
// databases, so the dropped listing's stay with its old address: check its page first and say so in the pull request
// if it has any.
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { roughPin } from './same-place.mjs';

const DIR = 'src/content/playgrounds';
const WORKER = 'worker/index.js';
const TOILETS = 'src/data/toilets.json';
const PINS = 'src/data/pins-checked.json';
const NOT = 'src/data/not-duplicates.json';

const osmOnly = (d) => !d.checked && (d.sources ?? []).length > 0 && d.sources.every((s) => /openstreetmap\.org\//.test(s.url));
const positionPart = (nc) => /^Exact position(\s*\([^)]*\))?/i.exec(String(nc ?? ''))?.[0] ?? null;
const empty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** The merged listing (a new object) and which pin it took. pin: 'keep' | 'drop' | undefined (choose). */
export function mergeDocs(keep, drop, pin) {
  if (osmOnly(keep) && !osmOnly(drop)) throw new Error('Keep the official listing: swap the two (the OpenStreetMap-only one is the one to drop).');
  const usePin = pin ?? (roughPin(keep.notConfirmed) && !roughPin(drop.notConfirmed) ? 'drop' : 'keep');
  const out = structuredClone(keep);
  const urls = new Set((out.sources ?? []).map((s) => s.url));
  out.sources = [...(out.sources ?? []), ...(drop.sources ?? []).filter((s) => !urls.has(s.url))];
  for (const k of ['ages', 'equipment', 'access', 'facilities', 'nearby', 'opens', 'operator', 'photo', 'babyChange']) {
    if (empty(out[k]) && !empty(drop[k])) out[k] = structuredClone(drop[k]);
  }
  if (usePin === 'drop') {
    out.lat = drop.lat;
    out.lng = drop.lng;
    const theirs = positionPart(drop.notConfirmed) ?? 'Exact position (taken from OpenStreetMap)';
    const ours = positionPart(out.notConfirmed);
    out.notConfirmed = ours ? out.notConfirmed.replace(ours, theirs) : `${theirs}. ${out.notConfirmed ?? ''}`.trim();
  }
  return { doc: out, pin: usePin };
}

/** worker/index.js with drop → keep added to MERGED, and older entries that pointed at drop pointed at keep. */
export function addMerged(src, drop, keep) {
  const start = src.indexOf('const MERGED = {');
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('MERGED not found in worker/index.js');
  let body = src.slice(start, end).replaceAll(`: '${drop}',`, `: '${keep}',`);
  if (!body.includes(`'${drop}':`)) body += `\n  '${drop}': '${keep}',`;
  return src.slice(0, start) + body + src.slice(end);
}

const sortKey = (a, b) => [a, b].sort().join(' + ');

async function separate(a, b, note) {
  if (!note) throw new Error('Say how you know they are separate: --note "…"');
  const data = JSON.parse(await readFile(NOT, 'utf8'));
  if (data.pairs.some((p) => sortKey(p.a, p.b) === sortKey(a, b))) return console.log('Already recorded.');
  data.pairs.push({ a, b, note });
  await writeFile(NOT, JSON.stringify(data, null, 2) + '\n');
  console.log(`Recorded ${a} and ${b} as separate places.`);
}

async function merge(keepId, dropId, pin, dry) {
  const read = async (id) => JSON.parse(await readFile(join(DIR, `${id}.json`), 'utf8'));
  const [keep, drop] = [await read(keepId), await read(dropId)];
  const { doc, pin: used } = mergeDocs(keep, drop, pin);
  console.log(`Keeping ${keepId} with ${used === 'drop' ? `${dropId}'s pin` : 'its own pin'}; dropping ${dropId}.`);
  if (dry) return console.log(JSON.stringify(doc, null, 2));
  await writeFile(join(DIR, `${keepId}.json`), JSON.stringify(doc, null, 2) + '\n');
  await unlink(join(DIR, `${dropId}.json`));
  await writeFile(WORKER, addMerged(await readFile(WORKER, 'utf8'), dropId, keepId));
  // The dropped listing's nearest toilets go; the kept one's are refreshed by the "Update nearest toilets" workflow.
  const toilets = JSON.parse(await readFile(TOILETS, 'utf8'));
  if (toilets.parks?.[dropId]) {
    delete toilets.parks[dropId];
    await writeFile(TOILETS, JSON.stringify(toilets, null, 1) + '\n');
  }
  // A hand-placed pin that moves to the kept listing stays hand-placed.
  const pins = JSON.parse(await readFile(PINS, 'utf8'));
  const was = pins.pins.find((p) => p.id === dropId);
  if (was) {
    pins.pins = pins.pins.filter((p) => p.id !== dropId && !(used === 'drop' && p.id === keepId));
    if (used === 'drop') pins.pins.push({ ...was, id: keepId });
    await writeFile(PINS, JSON.stringify(pins, null, 2) + '\n');
  }
  const not = JSON.parse(await readFile(NOT, 'utf8'));
  const left = not.pairs.filter((p) => p.a !== dropId && p.b !== dropId);
  if (left.length !== not.pairs.length) await writeFile(NOT, JSON.stringify({ ...not, pairs: left }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const [v] = args.splice(i, 2).slice(1);
    return v;
  };
  const dry = args.includes('--dry');
  const rest = () => args.filter((a) => a !== '--dry' && a !== '--separate');
  try {
    if (args.includes('--separate')) {
      const note = flag('--note');
      const [a, b] = rest();
      await separate(a, b, note);
    } else {
      const pin = flag('--pin');
      if (pin && !['keep', 'drop'].includes(pin)) throw new Error('--pin is keep or drop');
      const [keep, drop] = rest();
      if (!keep || !drop) throw new Error('Usage: node scripts/merge-playgrounds.mjs <keep> <drop> [--pin keep|drop] [--dry]');
      await merge(keep, drop, pin, dry);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

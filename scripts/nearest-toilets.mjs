// Finds the nearest public toilets to every playground, from the Toilet Map's open data
// (https://www.toiletmap.org.uk/dataset, CC BY 4.0), and writes src/data/toilets.json.
//
//   node scripts/nearest-toilets.mjs                 downloads the latest export
//   node scripts/nearest-toilets.mjs --csv file.csv  uses a CSV you've already downloaded
//
// Run it again whenever playgrounds are added or moved. The "Update nearest toilets" GitHub
// workflow does this automatically when playground files change, and once a month for new toilets.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATASET = 'https://www.toiletmap.org.uk/dataset';
const PLAYGROUNDS = 'src/content/playgrounds';
const OUT = 'src/data/toilets.json';
const MAX_KM = 3; // further than this isn't much help with a toddler
const BABY_EXTRA_KM = 1.5; // show a baby-change toilet as well if it's no more than this much further away

// A small CSV parser that copes with quoted fields, doubled quotes and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function latestCsv() {
  const html = await (await fetch(DATASET)).text();
  const url = html.match(/https:\/\/[^"'\s]+\/exports\/[^"'\s]+\.csv[^"'\s]*/)?.[0]?.replace(/&amp;/g, '&');
  if (!url) throw new Error(`Couldn't find the CSV download link on ${DATASET}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return { text: await res.text(), url };
}

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const flag = (v) => (v === 'true' ? true : v === 'false' ? false : null);

const csvArg = process.argv.indexOf('--csv');
const { text, url } = csvArg > 0 ? { text: await readFile(process.argv[csvArg + 1], 'utf8'), url: null } : await latestCsv();

const toilets = parseCsv(text)
  .filter((t) => t.active !== 'false')
  .map((t) => ({
    id: t.id,
    name: (t.name || '').trim() || 'Public toilet',
    lat: Number(t.latitude),
    lng: Number(t.longitude),
    babyChange: flag(t.baby_change),
    accessible: flag(t.accessible),
    free: flag(t.no_payment),
  }))
  .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng) && t.lat > 49 && t.lat < 61);

const out = {};
for (const f of (await readdir(PLAYGROUNDS)).filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(await readFile(join(PLAYGROUNDS, f), 'utf8'));
  const near = toilets
    .map((t) => ({ t, d: km(p, t) }))
    .filter((x) => x.d <= MAX_KM)
    .sort((a, b) => a.d - b.d);
  const pick = ({ t, d }) => ({ id: t.id, name: t.name, m: Math.round(d * 1000), babyChange: t.babyChange, accessible: t.accessible, free: t.free, lat: t.lat, lng: t.lng });
  const entry = { nearest: near[0] ? pick(near[0]) : null };
  const baby = near.find((x) => x.t.babyChange === true);
  if (baby && baby !== near[0] && baby.d - near[0].d <= BABY_EXTRA_KM) entry.nearestBabyChange = pick(baby);
  out[f.replace(/\.json$/, '')] = entry;
}

const data = {
  source: {
    name: 'Toilet Map',
    url: DATASET,
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    note: 'Nearest toilets worked out by Swing By from the Toilet Map data.',
    export: url ? url.split('/exports/')[1]?.split('?')[0] : 'local file',
  },
  toilets: toilets.length,
  parks: out,
};
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
const withAny = Object.values(out).filter((e) => e.nearest).length;
console.log(`${toilets.length} toilets; ${withAny} of ${Object.keys(out).length} playgrounds have one within ${MAX_KM} km. Wrote ${OUT}.`);

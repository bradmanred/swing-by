// Checks how much of the country Swing By covers. For each county, biggest population first, it compares
// the playgrounds mapped on OpenStreetMap with the ones we list, and reports the ones we're missing.
//
//   node scripts/find-gaps.mjs                       report only (writes reports/coverage.md and reports/gaps.json)
//   node scripts/find-gaps.mjs --add 150             also adds up to 150 missing playgrounds, biggest counties first
//   node scripts/find-gaps.mjs --only "Kent" --add 50
//   node scripts/find-gaps.mjs --limit 5             only check the first 5 counties (for a quick test)
//
// Added playgrounds follow docs/finding-playgrounds.md: they're Unverified (no "checked" date), the
// OpenStreetMap page is the source, and the OpenStreetMap credit is kept. Ones tagged private, indoor or
// at schools, pubs, hotels and holiday parks are left out, as are ones within 150 m of a playground we list.
// Run by .github/workflows/coverage.yml.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'src/content/playgrounds';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; finds playgrounds missing from the site)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SAME_M = 150; // an OpenStreetMap playground this close to one we list counts as the same place
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const ADD = Number(arg('--add', 0)) || 0;
const ONLY = arg('--only', '');
const LIMIT = Number(arg('--limit', 0)) || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ceremonial counties of England, and Wales, Scotland and Northern Ireland as a whole, with their
// approximate populations (thousands, 2021 and 2022 censuses), so the biggest are checked first.
const AREAS = [
  ['Greater London', 8866], ['Scotland', 5440, 'GB-SCT'], ['Wales', 3108, 'GB-WLS'], ['West Midlands', 2920], ['Greater Manchester', 2868],
  ['West Yorkshire', 2352], ['Northern Ireland', 1904, 'GB-NIR'], ['Kent', 1847], ['Hampshire', 1845], ['Essex', 1833], ['Lancashire', 1532],
  ['Merseyside', 1424], ['South Yorkshire', 1377], ['Surrey', 1203], ['Hertfordshire', 1198], ['Devon', 1195], ['North Yorkshire', 1158],
  ['Nottinghamshire', 1155], ['Staffordshire', 1131], ['Tyne and Wear', 1126], ['Leicestershire', 1095], ['Lincolnshire', 1088],
  ['Cheshire', 1077], ['Derbyshire', 1054], ['Somerset', 966], ['Norfolk', 917], ['Berkshire', 917], ['Gloucestershire', 916],
  ['Cambridgeshire', 897], ['West Sussex', 882], ['Durham', 866], ['East Sussex', 846], ['Buckinghamshire', 809], ['Northamptonshire', 786],
  ['Dorset', 776], ['Suffolk', 761], ['Oxfordshire', 726], ['Wiltshire', 720], ['Bedfordshire', 712], ['Worcestershire', 604],
  ['East Riding of Yorkshire', 600], ['Warwickshire', 597], ['Cornwall', 571], ['Shropshire', 507], ['Cumbria', 500], ['Bristol', 472],
  ['Northumberland', 320], ['Herefordshire', 187], ['Isle of Wight', 140], ['Rutland', 41],
].map(([name, pop, iso]) => ({ name, pop, iso }));

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
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

const BAD = /school|nursery|academy|primary|college|\bpub\b|inn\b|hotel|caravan|holiday park|soft play|ikea|mcdonald/i;
const isPublic = (t) => !['private', 'no', 'customers'].includes(t.access) && t.indoor !== 'yes' && !BAD.test(`${t.name ?? ''} ${t.operator ?? ''}`);

// Everything we list, as a coarse grid so "is there one within 150 m" is quick.
const ours = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  ours.push({ lat: d.lat, lng: d.lng, id: f.replace(/\.json$/, '') });
}
const cell = (p) => `${Math.floor(p.lat * 100)},${Math.floor(p.lng * 60)}`;
const grid = new Map();
const addToGrid = (p) => grid.set(cell(p), [...(grid.get(cell(p)) ?? []), p]);
ours.forEach(addToGrid);
const listed = (p) => {
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of grid.get(`${Math.floor(p.lat * 100) + a},${Math.floor(p.lng * 60) + b}`) ?? []) if (km(p, q) * 1000 < SAME_M) return true;
  return false;
};

const areas = AREAS.filter((a) => !ONLY || a.name.toLowerCase() === ONLY.toLowerCase()).slice(0, LIMIT);
if (!areas.length) throw new Error(`No county called ${ONLY}. Use one of: ${AREAS.map((a) => a.name).join(', ')}`);
const results = [];
for (const a of areas) {
  const sel = a.iso ? `area["ISO3166-2"="${a.iso}"]` : `area["boundary"="ceremonial"]["name"~"^(County |City of )?${a.name}$"]`;
  console.log(`${a.name}…`);
  const els = await overpass(`[out:json][timeout:600][maxsize:1073741824];${sel}->.a;nwr[leisure=playground](area.a);out center tags;`);
  if (!els) {
    results.push({ ...a, error: 'OpenStreetMap could not be reached' });
    continue;
  }
  const osm = els
    .map((e) => ({ id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, tags: e.tags ?? {} }))
    .filter((p) => p.lat != null && isPublic(p.tags));
  const missing = osm.filter((p) => !listed(p));
  results.push({ ...a, osm: osm.length, covered: osm.length - missing.length, missing });
  console.log(`  ${osm.length} public playgrounds on OpenStreetMap, ${missing.length} not on Swing By`);
  await sleep(5000);
}

// Report, biggest gaps per head of population first.
const done = results.filter((r) => !r.error);
const pct = (r) => (r.osm ? Math.round((100 * r.covered) / r.osm) : 100);
const lines = [
  '# Swing By coverage',
  '',
  `Checked ${new Date().toISOString().slice(0, 10)} against playgrounds mapped on OpenStreetMap (© OpenStreetMap contributors). Counties are in order of population. A playground counts as covered if we list one within ${SAME_M} m of it.`,
  '',
  '| County | Population | On OpenStreetMap | Covered | Missing | Coverage |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...results.map((r) => (r.error ? `| ${r.name} | ${r.pop}k | ${r.error} | | | |` : `| ${r.name} | ${r.pop}k | ${r.osm} | ${r.covered} | ${r.missing.length} | ${pct(r)}% |`)),
  '',
  `In all: ${done.reduce((n, r) => n + r.osm, 0)} public playgrounds on OpenStreetMap, ${done.reduce((n, r) => n + r.missing.length, 0)} not yet on Swing By.`,
];

// Optionally add the missing ones, biggest counties first.
const toAdd = [];
for (const r of done) for (const p of r.missing) if (toAdd.length < ADD && !toAdd.some((q) => km(p, q) * 1000 < 60)) toAdd.push({ ...p, county: r.name });
if (toAdd.length) {
  const existing = new Set(await readdir(DIR));
  // Postcodes.io gives the region and district; Nominatim gives the street and neighbourhood.
  const pcs = [];
  for (let i = 0; i < toAdd.length; i += 100) {
    const r = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ geolocations: toAdd.slice(i, i + 100).map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 1000, limit: 1 })) }),
    }).then((r) => r.json()).catch(() => null);
    pcs.push(...(r?.result ?? toAdd.slice(i, i + 100).map(() => null)).map((x) => x?.result?.[0] ?? null));
  }
  const REG = { 'North East': 'north-east', 'North West': 'north-west', 'Yorkshire and The Humber': 'yorkshire', 'East Midlands': 'east-midlands', 'West Midlands': 'west-midlands', 'East of England': 'east', London: 'london', 'South East': 'south-east', 'South West': 'south-west' };
  const CTY = { Hertfordshire: 'herts', Essex: 'essex', Derbyshire: 'derbyshire', Devon: 'devon' };
  const DIST = { Derby: 'derbyshire', Plymouth: 'devon', Torbay: 'devon', 'Southend-on-Sea': 'essex', Thurrock: 'essex' };
  const region = (p) => (!p ? null : { Wales: 'wales', Scotland: 'scotland', 'Northern Ireland': 'northern-ireland' }[p.country] ?? CTY[p.admin_county] ?? DIST[p.admin_district] ?? REG[p.region]);
  const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const GENERIC = /^(play(ground| area| park|park| space)?s?|children'?s play( area)?)$/i;
  const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
  let added = 0;
  for (const [i, p] of toAdd.entries()) {
    const pc = pcs[i];
    const reg = region(pc);
    if (!reg) continue;
    const a = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&addressdetails=1&lat=${p.lat}&lon=${p.lng}`, { headers: UA })
      .then((r) => r.json()).then((j) => j.address ?? {}).catch(() => ({}));
    await sleep(1100);
    let road = a.road ?? a.pedestrian ?? a.footway ?? '';
    if (BIG_ROAD.test(road)) road = '';
    const sub = a.suburb ?? a.village ?? a.neighbourhood ?? a.hamlet ?? '';
    const town = a.town ?? a.city ?? a.village ?? pc.admin_district ?? '';
    const place = sub || town;
    const tagName = (p.tags.name ?? '').trim();
    const name = tagName && !GENERIC.test(tagName) ? tagName : road ? `Playground off ${road}` : `${place} Playground`;
    const where = [road, place].filter(Boolean).join(', ');
    const doc = {
      name,
      region: reg,
      area: [...new Set([sub, town].filter(Boolean))].join(', ') || pc.admin_district,
      lat: Math.round(p.lat * 1e5) / 1e5,
      lng: Math.round(p.lng * 1e5) / 1e5,
      ages: [], equipment: [], access: [], facilities: [], opens: '',
      description: `A playground on OpenStreetMap${where ? ` near ${where}` : ''}. No council list we've checked includes it yet, so we can't confirm it's open to everyone or what it has.`,
      nearby: [],
      ...(p.tags.operator ? { operator: p.tags.operator } : {}),
      sources: [{ label: `OpenStreetMap: ${tagName || 'playground'}`, url: `https://www.openstreetmap.org/${p.id}` }],
      checked: null,
      notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges, play equipment, opening hours, toilets and parking. Listed from OpenStreetMap (© OpenStreetMap contributors) only, so whether it is open to the public is unconfirmed too.',
      photo: null,
    };
    let id = `c-${slug(`${name}-${doc.area}`).slice(0, 60)}`;
    while (existing.has(`${id}.json`)) id += '-2';
    existing.add(`${id}.json`);
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
    added++;
  }
  const by = Object.entries(toAdd.reduce((m, p) => ({ ...m, [p.county]: (m[p.county] ?? 0) + 1 }), {}));
  lines.push('', `Added ${added} of them as Unverified playgrounds: ${by.map(([c, n]) => `${c} ${n}`).join(', ')}.`);
}

await mkdir('reports', { recursive: true });
await writeFile('reports/coverage.md', lines.join('\n') + '\n');
await writeFile('reports/gaps.json', JSON.stringify(done.map((r) => ({ county: r.name, missing: r.missing.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, name: p.tags.name ?? null })) })), null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(lines.join('\n'));

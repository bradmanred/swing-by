// Checks how much of the country Swing By covers, council sources first.
//
// For each county, biggest population first, it compares the playgrounds mapped on OpenStreetMap with the
// ones we list and works out which council (local authority) each missing one is in. Then:
//   1. Councils with a machine-readable list in src/data/council-sources.json ("feed") are read first, and any
//      playground on the council's own list that we don't have is added as verified, with the council as source.
//   2. Only in councils whose own lists have already been checked (listed in council-sources.json) are the
//      remaining gaps filled from OpenStreetMap, as Unverified.
//   3. Everywhere else, the report lists the council as "check the council's own list first", with how many
//      playgrounds are missing, so a person (or Claude) can work through docs/finding-playgrounds.md for it.
//
//   node scripts/find-gaps.mjs                        report only (reports/coverage.md and reports/gaps.json)
//   node scripts/find-gaps.mjs --add 150              add up to 150 playgrounds, council-listed ones first
//   node scripts/find-gaps.mjs --only "Kent" --add 50
//   node scripts/find-gaps.mjs --osm-fallback --add 50   also fill gaps from OpenStreetMap in councils not yet checked
//   node scripts/find-gaps.mjs --limit 5              only the first 5 counties (for a quick test)
//
// Playgrounds from OpenStreetMap follow docs/finding-playgrounds.md: Unverified (no "checked" date), the
// OpenStreetMap page as the source, and the OpenStreetMap credit. Ones tagged private or indoor, or at schools,
// pubs, hotels and holiday parks, are left out, as are ones within 150 m of a playground we list.
// Run by .github/workflows/coverage.yml.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'src/content/playgrounds';
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; finds playgrounds missing from the site)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SAME_M = 150; // a playground this close to one we list counts as the same place
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const ADD = Number(arg('--add', 0)) || 0;
const ONLY = arg('--only', '');
const LIMIT = Number(arg('--limit', 0)) || Infinity;
const OSM_FALLBACK = process.argv.includes('--osm-fallback');
const TODAY = new Date().toISOString().slice(0, 10);
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

const councils = JSON.parse(await readFile('src/data/council-sources.json', 'utf8')).councils;
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/\b(city of|county of|borough of|council|district|borough|metropolitan|city|county|royal)\b/g, '').replace(/[^a-z]+/g, ' ').trim();
const councilFor = (district) => councils.find((c) => norm(c.district) === norm(district));

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

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

/** Postcodes.io details (district, region, country) for each point, 100 at a time. */
async function lookup(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    let res = null;
    for (let t = 0; t < 3 && !res; t++) {
      res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 2000, limit: 1 })) }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!res) await sleep(5000);
    }
    out.push(...(res?.result ?? chunk.map(() => null)).map((x) => x?.result?.[0] ?? null));
  }
  return out;
}

const BAD = /school|nursery|academy|primary|college|\bpub\b|inn\b|hotel|caravan|holiday park|soft play|ikea|mcdonald/i;
const isPublic = (t) => !['private', 'no', 'customers'].includes(t.access) && t.indoor !== 'yes' && !BAD.test(`${t.name ?? ''} ${t.operator ?? ''}`);

// Everything we list, on a coarse grid so "is there one within 150 m" is quick.
const grid = new Map();
const cellKey = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 60)}`;
const remember = (p) => grid.set(cellKey(p.lat, p.lng), [...(grid.get(cellKey(p.lat, p.lng)) ?? []), p]);
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  remember({ lat: d.lat, lng: d.lng });
}
const listed = (p) => {
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const q of grid.get(`${Math.floor(p.lat * 100) + a},${Math.floor(p.lng * 60) + b}`) ?? []) if (km(p, q) * 1000 < SAME_M) return true;
  return false;
};

// 1. OpenStreetMap, county by county.
const areas = AREAS.filter((a) => !ONLY || a.name.toLowerCase() === ONLY.toLowerCase()).slice(0, LIMIT);
if (!areas.length) throw new Error(`No county called ${ONLY}. Use one of: ${AREAS.map((a) => a.name).join(', ')}`);
const results = [];
for (const a of areas) {
  // Ceremonial county where OpenStreetMap has one, otherwise the county council's own boundary (as for Hertfordshire).
  const sel = a.iso
    ? `area["ISO3166-2"="${a.iso}"]`
    : `(area["boundary"="ceremonial"]["name"~"^(County |City of )?${a.name}$"];area["boundary"="administrative"]["admin_level"="6"]["name"~"^(County |City of )?${a.name}$"];)`;
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
  // Which council each missing playground is in.
  const where = await lookup(missing);
  missing.forEach((p, i) => (p.pc = where[i]));
  results.push({ ...a, osm: osm.length, covered: osm.length - missing.length, missing });
  console.log(`  ${osm.length} public playgrounds on OpenStreetMap, ${missing.length} not on Swing By`);
  await sleep(5000);
}
const done = results.filter((r) => !r.error);

// Gaps per council, in county order, biggest gap first within each county.
const byCouncil = [];
for (const r of done) {
  const groups = new Map();
  for (const p of r.missing) {
    const d = p.pc?.admin_district ?? 'Unknown council';
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }
  for (const [district, ps] of [...groups].sort((x, y) => y[1].length - x[1].length))
    byCouncil.push({ county: r.name, district, missing: ps, council: councilFor(district) });
}

// 2. Council feeds: read the council's own list and add anything on it we don't have, as verified.
async function readFeed(feed) {
  const recs = [];
  if (feed.type === 'directory') {
    const seen = new Set();
    for (const index of feed.index) {
      const html = await fetch(index, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      const links = [...html.matchAll(/href="([^"#]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), index).href).filter((u) => new RegExp(feed.follow).test(u));
      for (const u of links) {
        if (seen.has(u)) continue;
        seen.add(u);
        const page = await fetch(u, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
        const c = page.match(new RegExp(feed.coords));
        const n = page.match(new RegExp(feed.name));
        if (c && n) recs.push({ name: strip(n[1]).replace(/\s+[-|]\s.*$/, ''), lat: Number(c[1]), lng: Number(c[2]), url: u });
        await sleep(500);
      }
    }
  } else if (feed.type === 'geojson') {
    const j = await fetch(feed.url, { headers: UA }).then((r) => r.json()).catch(() => null);
    for (const f of j?.features ?? []) {
      const [lng, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : [];
      if (lat != null) recs.push({ name: strip(f.properties?.[feed.nameField]), lat, lng, url: feed.page ?? feed.url });
    }
  } else if (feed.type === 'csv') {
    const text = await fetch(feed.url, { headers: UA }).then((r) => r.text()).catch(() => '');
    const [head, ...rows] = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
    const col = (k) => head.findIndex((h) => h.trim().replace(/"/g, '') === k);
    for (const r of rows) {
      const lat = Number(r[col(feed.latField)]), lng = Number(r[col(feed.lngField)]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) recs.push({ name: strip(r[col(feed.nameField)]?.replace(/"/g, '')), lat, lng, url: feed.page ?? feed.url });
    }
  }
  return recs.filter((x) => x.name);
}

const toAdd = []; // { kind: 'council' | 'osm', ... }
const feedReport = [];
if (ADD > 0) {
  const districts = new Set(byCouncil.map((g) => g.district));
  for (const c of councils.filter((c) => c.feed && [...districts].some((d) => norm(d) === norm(c.district)))) {
    if (toAdd.length >= ADD) break;
    const recs = await readFeed(c.feed);
    const fresh = recs.filter((x) => !listed(x));
    feedReport.push(`${c.council}: ${recs.length} on the council's list, ${fresh.length} new`);
    for (const x of fresh) {
      if (toAdd.length >= ADD) break;
      toAdd.push({ kind: 'council', ...x, council: c });
      remember(x); // so OpenStreetMap copies of the same place aren't added too
    }
  }
  // 3. OpenStreetMap, only where the council's own list has been checked (unless --osm-fallback).
  for (const g of byCouncil) {
    if (!g.council && !OSM_FALLBACK) continue;
    for (const p of g.missing) {
      if (toAdd.length >= ADD) break;
      if (listed(p) || toAdd.some((q) => km(p, q) * 1000 < 60)) continue;
      toAdd.push({ kind: 'osm', ...p, county: g.county });
    }
  }
}

// Write the files.
let added = { council: 0, osm: 0 };
if (toAdd.length) {
  const existing = new Set(await readdir(DIR));
  const pcs = await lookup(toAdd);
  const REG = { 'North East': 'north-east', 'North West': 'north-west', 'Yorkshire and The Humber': 'yorkshire', 'East Midlands': 'east-midlands', 'West Midlands': 'west-midlands', 'East of England': 'east', London: 'london', 'South East': 'south-east', 'South West': 'south-west' };
  const CTY = { Hertfordshire: 'herts', Essex: 'essex', Derbyshire: 'derbyshire', Devon: 'devon' };
  const DIST = { Derby: 'derbyshire', Plymouth: 'devon', Torbay: 'devon', 'Southend-on-Sea': 'essex', Thurrock: 'essex' };
  const region = (p) => (!p ? null : { Wales: 'wales', Scotland: 'scotland', 'Northern Ireland': 'northern-ireland' }[p.country] ?? CTY[p.admin_county] ?? DIST[p.admin_district] ?? REG[p.region]);
  const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const GENERIC = /^(play(ground| area| park|park| space)?s?|children'?s play( area)?)$/i;
  const BIG_ROAD = /^(M\d+|A\d+(\(M\))?|.*Bypass)$/;
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
    const area = [...new Set([sub, town].filter(Boolean))].join(', ') || pc.admin_district;
    let doc;
    if (p.kind === 'council') {
      doc = {
        name: p.name, region: reg, area, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5,
        ages: [], equipment: [], access: [], facilities: [], opens: '',
        description: `A playground on ${p.council.council}'s own list of play areas.`,
        nearby: [], operator: p.council.council,
        sources: [{ label: `${p.council.council}: ${p.name}`, url: p.url }],
        checked: TODAY,
        notConfirmed: "Exact position (from the council's map), age ranges, play equipment, opening hours, toilets and parking.",
        photo: null,
      };
    } else {
      const tagName = (p.tags.name ?? '').trim();
      const name = tagName && !GENERIC.test(tagName) ? tagName : road ? `Playground off ${road}` : `${place} Playground`;
      const near = [road, place].filter(Boolean).join(', ');
      doc = {
        name, region: reg, area, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5,
        ages: [], equipment: [], access: [], facilities: [], opens: '',
        description: `A playground on OpenStreetMap${near ? ` near ${near}` : ''}. No council list we've checked includes it yet, so we can't confirm it's open to everyone or what it has.`,
        nearby: [],
        ...(p.tags.operator ? { operator: p.tags.operator } : {}),
        sources: [{ label: `OpenStreetMap: ${tagName || 'playground'}`, url: `https://www.openstreetmap.org/${p.id}` }],
        checked: null,
        notConfirmed: 'Exact position (taken from OpenStreetMap), age ranges, play equipment, opening hours, toilets and parking. Listed from OpenStreetMap (© OpenStreetMap contributors) only, so whether it is open to the public is unconfirmed too.',
        photo: null,
      };
    }
    let id = `c-${slug(`${doc.name}-${doc.area}`).slice(0, 60)}`;
    while (existing.has(`${id}.json`)) id += '-2';
    existing.add(`${id}.json`);
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
    added[p.kind]++;
  }
}

// Report.
const pct = (r) => (r.osm ? Math.round((100 * r.covered) / r.osm) : 100);
const todo = byCouncil.filter((g) => !g.council && g.district !== 'Unknown council');
const search = (d) => `https://duckduckgo.com/?q=${encodeURIComponent(`${d} council play areas`)}`;
const lines = [
  '# Swing By coverage',
  '',
  `Checked ${TODAY} against playgrounds mapped on OpenStreetMap (© OpenStreetMap contributors). Counties are in order of population. A playground counts as covered if we list one within ${SAME_M} m of it.`,
  '',
  '| County | Population | On OpenStreetMap | Covered | Missing | Coverage |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...results.map((r) => (r.error ? `| ${r.name} | ${r.pop}k | ${r.error} | | | |` : `| ${r.name} | ${r.pop}k | ${r.osm} | ${r.covered} | ${r.missing.length} | ${pct(r)}% |`)),
  '',
  `In all: ${done.reduce((n, r) => n + r.osm, 0)} public playgrounds on OpenStreetMap, ${done.reduce((n, r) => n + r.missing.length, 0)} not yet on Swing By.`,
  '',
  '## Check these councils\' own lists first',
  '',
  'Gaps here are not filled from OpenStreetMap until the council\'s own play area list has been checked (docs/finding-playgrounds.md) and the council added to src/data/council-sources.json. Biggest counties first.',
  '',
  '| County | Council | Missing | Look for its list |',
  '| --- | --- | ---: | --- |',
  ...todo.slice(0, 60).map((g) => `| ${g.county} | ${g.district} | ${g.missing.length} | [search](${search(g.district)}) |`),
  ...(todo.length > 60 ? [``, `…and ${todo.length - 60} more councils.`] : []),
];
if (feedReport.length) lines.push('', '## Council lists read', '', ...feedReport.map((l) => `- ${l}`));
if (added.council || added.osm)
  lines.push('', `Added ${added.council} playgrounds from council lists (verified) and ${added.osm} from OpenStreetMap (Unverified, in councils whose own lists have been checked${OSM_FALLBACK ? ', plus councils not yet checked' : ''}).`);
else if (ADD > 0) lines.push('', 'Nothing added: no council list had new playgrounds, and the remaining gaps are all in councils whose own lists need checking first.');

await mkdir('reports', { recursive: true });
await writeFile('reports/coverage.md', lines.join('\n') + '\n');
await writeFile('reports/gaps.json', JSON.stringify(byCouncil.map((g) => ({ county: g.county, council: g.district, checked: !!g.council, missing: g.missing.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, name: p.tags.name ?? null })) })), null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' });
console.log(lines.join('\n'));
// devon 1792867603

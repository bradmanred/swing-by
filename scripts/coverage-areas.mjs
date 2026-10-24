// Works out which counties (English ceremonial counties) and nations Swing By covers, for the home page.
// Looks up every playground's local authority on postcodes.io and writes src/data/coverage.json.
//
//   node scripts/coverage-areas.mjs
//
// Run by the "Update nearest toilets" workflow whenever playgrounds change.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'src/content/playgrounds';
const OUT = 'src/data/coverage.json';
const MIN = 3; // a county counts once it has at least this many playgrounds

// Metropolitan boroughs and unitary authorities, by the ceremonial county they're in. Districts in two-tier
// counties come with their county (admin_county) from postcodes.io, and London boroughs with region "London".
const COUNTY = {
  'Greater Manchester': ['Bolton', 'Bury', 'Manchester', 'Oldham', 'Rochdale', 'Salford', 'Stockport', 'Tameside', 'Trafford', 'Wigan'],
  Merseyside: ['Knowsley', 'Liverpool', 'St. Helens', 'St Helens', 'Sefton', 'Wirral'],
  'South Yorkshire': ['Barnsley', 'Doncaster', 'Rotherham', 'Sheffield'],
  'Tyne and Wear': ['Gateshead', 'Newcastle upon Tyne', 'North Tyneside', 'South Tyneside', 'Sunderland'],
  'West Midlands': ['Birmingham', 'Coventry', 'Dudley', 'Sandwell', 'Solihull', 'Walsall', 'Wolverhampton'],
  'West Yorkshire': ['Bradford', 'Calderdale', 'Kirklees', 'Leeds', 'Wakefield'],
  Bedfordshire: ['Bedford', 'Central Bedfordshire', 'Luton'],
  Berkshire: ['Bracknell Forest', 'Reading', 'Slough', 'West Berkshire', 'Windsor and Maidenhead', 'Wokingham'],
  Bristol: ['Bristol, City of', 'Bristol'],
  Buckinghamshire: ['Buckinghamshire', 'Milton Keynes'],
  Cambridgeshire: ['Peterborough'],
  Cheshire: ['Cheshire East', 'Cheshire West and Chester', 'Halton', 'Warrington'],
  Cornwall: ['Cornwall', 'Isles of Scilly'],
  Cumbria: ['Cumberland', 'Westmorland and Furness'],
  Derbyshire: ['Derby'],
  Devon: ['Plymouth', 'Torbay'],
  Dorset: ['Bournemouth, Christchurch and Poole', 'Dorset'],
  Durham: ['County Durham', 'Darlington', 'Hartlepool', 'Stockton-on-Tees'],
  'East Riding of Yorkshire': ['East Riding of Yorkshire', 'Kingston upon Hull, City of', 'Kingston upon Hull'],
  'East Sussex': ['Brighton and Hove'],
  Essex: ['Southend-on-Sea', 'Thurrock'],
  Gloucestershire: ['South Gloucestershire'],
  Hampshire: ['Portsmouth', 'Southampton'],
  Herefordshire: ['Herefordshire, County of', 'Herefordshire'],
  'Isle of Wight': ['Isle of Wight'],
  Kent: ['Medway'],
  Leicestershire: ['Leicester'],
  Lincolnshire: ['North East Lincolnshire', 'North Lincolnshire'],
  Northamptonshire: ['North Northamptonshire', 'West Northamptonshire'],
  Northumberland: ['Northumberland'],
  'North Yorkshire': ['York', 'North Yorkshire', 'Middlesbrough', 'Redcar and Cleveland'],
  Nottinghamshire: ['Nottingham'],
  Rutland: ['Rutland'],
  Shropshire: ['Shropshire', 'Telford and Wrekin'],
  Somerset: ['Somerset', 'North Somerset', 'Bath and North East Somerset'],
  Staffordshire: ['Stoke-on-Trent'],
  Wiltshire: ['Wiltshire', 'Swindon'],
};
const byDistrict = Object.fromEntries(Object.entries(COUNTY).flatMap(([c, ds]) => ds.map((d) => [d, c])));

const pts = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  pts.push({ lat: d.lat, lng: d.lng });
}
const counties = {}, nations = {};
for (let i = 0; i < pts.length; i += 100) {
  const chunk = pts.slice(i, i + 100);
  const res = await fetch('https://api.postcodes.io/postcodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geolocations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng, radius: 2000, limit: 1 })) }),
  }).then((r) => (r.ok ? r.json() : null));
  if (!res) throw new Error('postcodes.io could not be reached');
  for (const x of res.result) {
    const p = x.result?.[0];
    if (!p) continue;
    if (p.country && p.country !== 'England') nations[p.country] = (nations[p.country] ?? 0) + 1;
    else {
      const c = p.region === 'London' ? 'Greater London' : p.admin_county ?? byDistrict[p.admin_district] ?? p.admin_district;
      counties[c] = (counties[c] ?? 0) + 1;
    }
  }
}
const sortDesc = (o) => Object.entries(o).filter(([, n]) => n >= MIN).sort((a, b) => b[1] - a[1]).map(([name, playgrounds]) => ({ name, playgrounds }));
const out = { updated: new Date().toISOString().slice(0, 10), counties: sortDesc(counties), nations: sortDesc(nations) };
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.counties.length} counties: ${out.counties.map((c) => `${c.name} ${c.playgrounds}`).join(', ')}`);
console.log(`Nations: ${out.nations.map((c) => `${c.name} ${c.playgrounds}`).join(', ')}`);

// Which ceremonial county (England) or nation a place is in, from its postcodes.io details. Used for the home page's
// list of covered counties (scripts/coverage-areas.mjs) and to sort OpenStreetMap playgrounds into counties when the
// coverage check works from the saved snapshot (scripts/find-gaps.mjs).

// Metropolitan boroughs and unitary authorities, by the ceremonial county they're in. Districts in two-tier
// counties come with their county (admin_county) from postcodes.io, and London boroughs with region "London".
export const COUNTY = {
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
export const byDistrict = Object.fromEntries(Object.entries(COUNTY).flatMap(([c, ds]) => ds.map((d) => [d, c])));

/** County or nation for a postcodes.io result: 'Greater London', 'West Midlands', 'Kent', 'Scotland', … or null. */
export function countyOf(p) {
  if (!p) return null;
  if (p.country && p.country !== 'England') return p.country;
  return p.region === 'London' ? 'Greater London' : p.admin_county ?? byDistrict[p.admin_district] ?? p.admin_district ?? null;
}

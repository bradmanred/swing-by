// Everything the site search looks through, built with the site so it's always up to date.
import { allParks, L, regionName } from '../lib/parks';

const PAGES = [
  { url: '/', title: 'Find a playground', text: 'Search by town or postcode, use Near me, filter by age, size and equipment, map of nearby parks, suggest how to make the site better' },
  { url: '/playgrounds/', title: 'All playgrounds A to Z', text: 'Every playground we list, grouped by county and town' },
  { url: '/road-trips/', title: 'Road trips: break a long drive', text: 'Playgrounds about 5 minutes off motorway and major road junctions, with toilets and cafés' },
  { url: '/memberships/', title: 'Use your membership', text: 'National Trust, English Heritage, Historic Houses, National Trust for Scotland, RHS gardens, WWT wetland centres, Cadw and Historic Environment Scotland play areas, free entry for members' },
  { url: '/my-parks/', title: 'My parks', text: "Playgrounds you've been to and rated, saved on this device" },
  { url: '/about/', title: 'About our data', text: 'Where playground details come from, how we check them, photos, maps, postcodes and privacy' },
];

export async function GET() {
  const parks = (await allParks()).map((p) => ({
    id: p.id,
    n: p.name,
    a: p.area,
    r: regionName(p.region),
    o: p.operator ?? '',
    f: [...p.equipment, ...p.access, ...p.facilities].map((k) => L.equipment[k] ?? L.access[k] ?? L.facilities[k]).filter(Boolean),
    m: [p.membership ? L.memberships[p.membership] : '', p.size ? L.sizes[p.size] : '', p.fee ? 'Paid entry' : ''].filter(Boolean).join(' '),
    d: p.description,
    c: !!p.checked,
  }));
  return new Response(JSON.stringify({ parks, pages: PAGES }), { headers: { 'Content-Type': 'application/json' } });
}

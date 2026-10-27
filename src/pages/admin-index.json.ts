// What the "Find a playground" panel in /admin/ searches, filters and sorts. Built with the site.
// Kept separate from /search-index.json so the public search doesn't download fields only editors need.
import { allParks, regionName } from '../lib/parks';

export async function GET() {
  const parks = (await allParks()).map((p) => ({
    id: p.id,
    n: p.name,
    a: p.area,
    r: p.region,
    rn: regionName(p.region),
    k: p.checked ?? '',
  }));
  return new Response(JSON.stringify({ parks }), { headers: { 'Content-Type': 'application/json' } });
}

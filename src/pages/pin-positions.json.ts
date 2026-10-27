// Where every pin is, built with the site. The Worker (worker/pins.js) uses it to check that a parent's suggested
// position is near the playground they're on.
import { allParks } from '../lib/parks';

export async function GET() {
  const pins = Object.fromEntries((await allParks()).map((p) => [p.id, [p.lat, p.lng]]));
  return new Response(JSON.stringify(pins), { headers: { 'Content-Type': 'application/json' } });
}

// Playground ids, shared by the photo, tick-box and pin endpoints.
//
// Until October 2026 most ids started with "c-" (c-badgers-recreation-ground-chesterfield). The prefix was dropped,
// but pages cached in browsers, links people saved and older scripts may still send the old form for a while, so
// an id that isn't known is tried again without "c-".
export const PARK = /^[a-z0-9-]{1,80}$/;

// Every playground and its pin, from /pin-positions.json, built with the site. Kept for a few minutes per Worker.
let index = null;
let loaded = 0;
async function parks(request, env) {
  if (!index || Date.now() - loaded > 5 * 60 * 1000) {
    const res = await env.ASSETS.fetch(new Request(new URL('/pin-positions.json', request.url), { method: 'GET' }));
    if (!res.ok) return index ?? {};
    index = await res.json();
    loaded = Date.now();
  }
  return index;
}

/** The playground's current id, or null if there's no such playground. Accepts the old "c-" form. */
export async function canonicalPark(request, env, park) {
  park = String(park ?? '');
  if (!PARK.test(park)) return null;
  const all = await parks(request, env);
  if (all[park]) return park;
  if (park.startsWith('c-') && all[park.slice(2)]) return park.slice(2);
  return null;
}

/** Where a playground's pin is now, as { lat, lng }, or null. */
export async function pinOf(request, env, park) {
  const p = (await parks(request, env))[park];
  return p ? { lat: p[0], lng: p[1] } : null;
}

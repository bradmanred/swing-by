// Parents tell us where a playground really is when its pin is in the wrong place. Stored in the D1 database bound as
// PHOTOS_DB (table: db/pins.sql).
//
// The same rule as the tick boxes (worker/equipment.js): one parent's suggestion is never acted on by itself. A pin
// only moves once at least two different parents (different browsers and different internet connections) have put
// it within AGREE_M metres of the same spot, and more households agree on that spot than on any other. A parent who
// puts the marker back on the current pin counts towards "the pin is right". The daily "Move pins parents agree
// on" workflow (scripts/parent-pins.mjs) reads the agreed spots and moves the pins in the playground files.
//
// Public:
//   GET  /api/pins?park=<id>     { agreed: { lat, lng, parents } | null, parents: n, mine: { lat, lng } | null }
//   POST /api/pins               JSON { park, lat, lng } sets this browser's suggestion; lat and lng null withdraws it.
// Moderators (Authorization: Bearer <MOD_TOKEN>):
//   GET  /api/pins/agreed        every playground where parents agree the pin should move at least MOVE_M metres
//   POST /api/pins/clear         JSON { park } removes every suggestion for one playground (for abuse)
import { isModerator } from './auth.js';
import { PARK, canonicalPark, pinOf } from './ids.js';

export const AGREE_M = 40; // suggestions this close together count as the same spot
export const MOVE_M = 30; // an agreed spot closer than this to the pin means the pin is fine
export const MAX_M = 1000; // suggestions further than this from the pin are refused: probably a different playground
const NEEDED = 2; // households who must agree
const PARKS_PER_DAY = 40; // per connection
const COOKIE = 'sb_pin';
const YEAR = 60 * 60 * 24 * 365;

export function metres(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
const households = (rows) => Math.min(new Set(rows.map((r) => r.reporter)).size, new Set(rows.map((r) => r.conn)).size);
const centre = (rows) => ({ lat: rows.reduce((s, r) => s + r.lat, 0) / rows.length, lng: rows.reduce((s, r) => s + r.lng, 0) / rows.length });

/** The best-supported spot among some suggestions: { rows, households, at } or null. */
function bestSpot(rows) {
  let best = null;
  for (const seed of rows) {
    const near = rows.filter((r) => metres(seed, r) <= AGREE_M);
    const n = households(near);
    const at = centre(near);
    const spread = near.reduce((s, r) => s + metres(at, r), 0) / near.length;
    if (!best || n > best.households || (n === best.households && spread < best.spread)) best = { rows: near, households: n, at, spread };
  }
  return best;
}

/**
 * Applies the two-parent rule to one playground's suggestions. Returns { lat, lng, parents } when at least two
 * households agree on one spot and fewer agree on any other spot, otherwise null.
 */
export function agree(rows) {
  const best = bestSpot(rows);
  if (!best || best.households < NEEDED) return null;
  // The strongest rival: suggestions clearly away from the agreed spot.
  const rival = bestSpot(rows.filter((r) => metres(best.at, r) > AGREE_M));
  if (rival && rival.households >= best.households) return null;
  return { lat: Math.round(best.at.lat * 1e5) / 1e5, lng: Math.round(best.at.lng * 1e5) / 1e5, parents: best.households };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const sameOrigin = (request) => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};
const parentFrom = (request) => /(?:^|;\s*)sb_pin=([0-9a-f-]{36})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1] ?? null;

async function connectionId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`swing-by-pins:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

const rowsFor = async (env, park) => (await env.PHOTOS_DB.prepare('SELECT reporter, conn, lat, lng FROM pin_reports WHERE park = ?').bind(park).all()).results;

async function forPark(request, env, given) {
  const park = await canonicalPark(request, env, given);
  if (!park) return json({ error: 'Which playground?' }, 400);
  const rows = await rowsFor(env, park);
  const me = parentFrom(request);
  const mine = rows.find((r) => r.reporter === me);
  return json({ agreed: agree(rows), parents: households(rows), mine: mine ? { lat: mine.lat, lng: mine.lng } : null });
}

async function submit(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send the position as JSON.' }, 400);
  }
  const park = await canonicalPark(request, env, body.park);
  if (!park) return json({ error: "We couldn't find that playground." }, 400);
  const pin = await pinOf(request, env, park);
  if (!pin) return json({ error: "We couldn't find that playground." }, 400);
  const withdraw = body.lat == null && body.lng == null;
  const at = { lat: Number(body.lat), lng: Number(body.lng) };
  if (!withdraw) {
    if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return json({ error: 'Put the marker where the playground is, then send.' }, 400);
    if (metres(pin, at) > MAX_M)
      return json({ error: "That's more than a kilometre from the pin, so it's probably a different playground. Check you're on the right playground's page." }, 400);
  }

  const conn = await connectionId(request);
  let parent = parentFrom(request);
  const headers = {};
  if (!parent) {
    parent = crypto.randomUUID();
    headers['Set-Cookie'] = `${COOKIE}=${parent}; Path=/api/pins; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
  }
  if (!withdraw) {
    const today = await env.PHOTOS_DB.prepare(
      "SELECT COUNT(DISTINCT park) AS n FROM pin_reports WHERE conn = ? AND park != ? AND created_at > datetime('now', '-1 day')",
    ).bind(conn, park).first('n');
    if ((today ?? 0) >= PARKS_PER_DAY) return json({ error: "You've moved a lot of pins today. Thank you! Please try again tomorrow." }, 429, headers);
  }
  await env.PHOTOS_DB.batch([
    env.PHOTOS_DB.prepare('DELETE FROM pin_reports WHERE park = ? AND reporter = ?').bind(park, parent),
    ...(withdraw ? [] : [env.PHOTOS_DB.prepare('INSERT INTO pin_reports (park, reporter, conn, lat, lng) VALUES (?, ?, ?, ?, ?)').bind(park, parent, conn, at.lat, at.lng)]),
  ]);
  const rows = await rowsFor(env, park);
  return json({ agreed: agree(rows), parents: households(rows), mine: withdraw ? null : at, saved: !withdraw }, 200, headers);
}

async function agreedIndex(request, env) {
  const { results } = await env.PHOTOS_DB.prepare('SELECT park, reporter, conn, lat, lng FROM pin_reports').all();
  const byPark = new Map();
  for (const r of results) byPark.set(r.park, [...(byPark.get(r.park) ?? []), r]);
  const parks = [];
  for (const [park, rows] of byPark) {
    const a = agree(rows);
    if (!a) continue;
    const pin = await pinOf(request, env, park);
    const m = pin ? Math.round(metres(pin, a)) : null;
    if (m != null && m < MOVE_M) continue;
    parks.push({ park, ...a, pin, metres: m, suggestions: rows.length });
  }
  parks.sort((a, b) => b.parents - a.parents || a.park.localeCompare(b.park));
  return json({ parks });
}

export async function pins({ request, env, pathname }) {
  if (!env.PHOTOS_DB) return json({ error: 'This is not set up yet.' }, 503);
  const m = request.method;
  if (pathname === '/api/pins') {
    if (m === 'GET') return forPark(request, env, new URL(request.url).searchParams.get('park') || '');
    if (m === 'POST') return submit(request, env);
    return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST' });
  }
  if (pathname === '/api/pins/agreed' || pathname === '/api/pins/clear') {
    if (!env.MOD_TOKEN || !isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    if (pathname === '/api/pins/agreed' && m === 'GET') return agreedIndex(request, env);
    if (pathname === '/api/pins/clear' && m === 'POST') {
      const given = String((await request.json().catch(() => ({}))).park || '');
      const park = (await canonicalPark(request, env, given)) ?? given;
      if (!PARK.test(park)) return json({ error: 'Which playground?' }, 400);
      await env.PHOTOS_DB.prepare('DELETE FROM pin_reports WHERE park = ?').bind(park).run();
      return json({ cleared: park });
    }
  }
  return json({ error: 'Not found.' }, 404);
}

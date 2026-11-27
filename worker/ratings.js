// Parents' star ratings, shared with other parents. Stored in the D1 database bound as PHOTOS_DB (table: db/ratings.sql).
//
// Like the equipment ticks, one parent's rating is never shown on its own: a playground's average only appears once
// at least two different households (different browsers and different internet connections) have rated it. Two
// browsers on one connection count as one household, using the most recent rating from that connection.
//
// Public:
//   GET  /api/ratings?park=<id>    { stars: 4.3 | null, parents: n, mine: 1-5 | null }
//   GET  /api/ratings/all          { parks: { <id>: [average, parents] } } every playground with a shown average,
//                                  for the finder's "Rated 4★ or more" filter; cached for a few minutes
//   POST /api/ratings              JSON { park, stars: 1-5 | null }  sets or (with null) removes this browser's rating
// Moderators (Authorization: Bearer <MOD_TOKEN>):
//   POST /api/ratings/clear        JSON { park } removes every rating for one playground (for abuse)
import { isModerator } from './auth.js';
import { PARK, canonicalPark } from './ids.js';

export const NEEDED = 2; // households who must rate before an average is shown
const PARKS_PER_DAY = 40; // per connection, to stop one person rating the whole map
const COOKIE = 'sb_parent';
const YEAR = 60 * 60 * 24 * 365;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const sameOrigin = (request) => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};
const parentFrom = (request) => /(?:^|;\s*)sb_parent=([0-9a-f-]{36})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1] ?? null;

async function connectionId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`swing-by-ratings:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * One playground's rows ({ reporter, conn, stars, created_at }) → { stars, parents }. Keeps one rating per browser and
 * one per connection (the newest), so a household counts once. stars is null until NEEDED households have rated.
 */
export function summarise(rows) {
  const newest = [...rows].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const reporters = new Set(), conns = new Set(), kept = [];
  for (const r of newest) {
    if (reporters.has(r.reporter) || conns.has(r.conn)) continue;
    reporters.add(r.reporter);
    conns.add(r.conn);
    kept.push(Number(r.stars));
  }
  const parents = kept.length;
  const stars = parents >= NEEDED ? Math.round((kept.reduce((s, n) => s + n, 0) / parents) * 10) / 10 : null;
  return { stars, parents };
}

const rowsFor = async (env, park) =>
  (await env.PHOTOS_DB.prepare('SELECT reporter, conn, stars, created_at FROM ratings WHERE park = ?').bind(park).all()).results;

async function forPark(request, env, given) {
  const park = await canonicalPark(request, env, given);
  if (!park) return json({ error: 'Which playground?' }, 400);
  const rows = await rowsFor(env, park);
  const me = parentFrom(request);
  return json({ ...summarise(rows), mine: rows.find((r) => r.reporter === me)?.stars ?? null });
}

async function submit(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send your rating as JSON.' }, 400);
  }
  const park = await canonicalPark(request, env, body.park);
  if (!park) return json({ error: "We couldn't find that playground." }, 400);
  const stars = body.stars == null ? null : Number(body.stars);
  if (stars != null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) return json({ error: 'Choose 1 to 5 stars.' }, 400);

  const conn = await connectionId(request);
  let parent = parentFrom(request);
  const headers = {};
  if (!parent) {
    parent = crypto.randomUUID();
    headers['Set-Cookie'] = `${COOKIE}=${parent}; Path=/api/ratings; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
  }
  if (stars == null) {
    await env.PHOTOS_DB.prepare('DELETE FROM ratings WHERE park = ? AND reporter = ?').bind(park, parent).run();
  } else {
    const today = await env.PHOTOS_DB.prepare(
      "SELECT COUNT(DISTINCT park) AS n FROM ratings WHERE conn = ? AND park != ? AND created_at > datetime('now', '-1 day')",
    ).bind(conn, park).first('n');
    if ((today ?? 0) >= PARKS_PER_DAY) return json({ error: "You've rated a lot of playgrounds today. Thank you! Please try again tomorrow." }, 429, headers);
    await env.PHOTOS_DB.prepare(
      "INSERT INTO ratings (park, reporter, conn, stars) VALUES (?, ?, ?, ?) ON CONFLICT (park, reporter) DO UPDATE SET stars = excluded.stars, conn = excluded.conn, created_at = datetime('now')",
    ).bind(park, parent, conn, stars).run();
  }
  return json({ ...summarise(await rowsFor(env, park)), mine: stars }, 200, headers);
}

async function allParks(env) {
  const { results } = await env.PHOTOS_DB.prepare('SELECT park, reporter, conn, stars, created_at FROM ratings').all();
  const byPark = new Map();
  for (const r of results) byPark.set(r.park, [...(byPark.get(r.park) ?? []), r]);
  const parks = {};
  for (const [park, rows] of [...byPark].sort(([a], [b]) => a.localeCompare(b))) {
    const s = summarise(rows);
    if (s.stars != null) parks[park] = [s.stars, s.parents];
  }
  return json({ parks }, 200, { 'Cache-Control': 'public, max-age=300' });
}

export async function ratings({ request, env, pathname }) {
  if (!env.PHOTOS_DB) return json({ error: 'This is not set up yet.' }, 503);
  const m = request.method;
  if (pathname === '/api/ratings') {
    if (m === 'GET') return forPark(request, env, new URL(request.url).searchParams.get('park') || '');
    if (m === 'POST') return submit(request, env);
    return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST' });
  }
  if (pathname === '/api/ratings/all') return m === 'GET' ? allParks(env) : json({ error: 'Use GET.' }, 405, { Allow: 'GET' });
  if (pathname === '/api/ratings/clear' && m === 'POST') {
    if (!env.MOD_TOKEN || !isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    const given = String((await request.json().catch(() => ({}))).park || '');
    const park = (await canonicalPark(request, env, given)) ?? given;
    if (!PARK.test(park)) return json({ error: 'Which playground?' }, 400);
    await env.PHOTOS_DB.prepare('DELETE FROM ratings WHERE park = ?').bind(park).run();
    return json({ cleared: park });
  }
  return json({ error: 'Not found.' }, 404);
}

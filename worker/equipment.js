// Parents tell us what a playground has, stored in the D1 database bound as PHOTOS_DB (table: db/equipment.sql).
//
// One parent's answers are never shown on their own. An item only appears on the playground page once at least
// two different parents (different browsers and different internet connections) have ticked it. The same goes
// for "Is this a public playground?": it needs two parents agreeing, and more saying so than saying otherwise.
//
// Public:
//   GET  /api/equipment?park=<id>    { confirmed: [codes], open: true | false | null, parents: n, mine: { items, open } }
//   POST /api/equipment              JSON { park, items: [codes], open: true | false | null }
//                                    Replaces this browser's answers for that playground. An empty list and a null
//                                    "open" withdraws them.
// Moderators (Authorization: Bearer <MOD_TOKEN>):
//   GET  /api/equipment/confirmed    every playground with parent-confirmed answers, to fold into the playground files
//   POST /api/equipment/clear        JSON { park } removes every parent answer for one playground (for abuse)
import labels from '../src/data/labels.json';
import { isModerator } from './auth.js';

// What parents can tick: the equipment, access and facility lists used across the site, except toilets and
// baby change, which only come from official sources and the Toilet Map.
export const ITEMS = new Set([...Object.keys(labels.equipment), ...Object.keys(labels.access), ...Object.keys(labels.facilities)].filter((k) => !['wc', 'bc'].includes(k)));
const OPEN = 'open'; // stored like an item: present 1 = a public playground is here, 0 = there isn't
const NEEDED = 2; // parents who must agree before an answer is shown
const PARKS_PER_DAY = 40; // per connection, to stop one person filling in the whole map
const PARK = /^[a-z0-9-]{1,80}$/;
const COOKIE = 'sb_parent';
const YEAR = 60 * 60 * 24 * 365;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

const sameOrigin = (request) => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};
const parentFrom = (request) => /(?:^|;\s*)sb_parent=([0-9a-f-]{36})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1] ?? null;

// A one-way hash of the connection's IP address, so two answers from the same connection count as one parent.
async function connectionId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`swing-by-equipment:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function parkExists(request, env, park) {
  if (!PARK.test(park)) return false;
  const res = await env.ASSETS.fetch(new Request(new URL(`/playgrounds/${park}/`, request.url), { method: 'GET' }));
  return res.status === 200;
}

// Count each answer once per parent and once per connection, then apply the two-parent rule.
function summarise(rows) {
  const yes = new Map(), no = new Map();
  for (const r of rows) {
    const m = r.present ? yes : no;
    const s = m.get(r.item) ?? { parents: new Set(), conns: new Set() };
    s.parents.add(r.reporter);
    s.conns.add(r.conn);
    m.set(r.item, s);
  }
  const count = (s) => (s ? Math.min(s.parents.size, s.conns.size) : 0);
  const confirmed = [...yes.keys()].filter((k) => k !== OPEN && ITEMS.has(k) && count(yes.get(k)) >= NEEDED).sort();
  const y = count(yes.get(OPEN)), n = count(no.get(OPEN));
  const open = y >= NEEDED && y > n ? true : n >= NEEDED && n > y ? false : null;
  return { confirmed, open, parents: new Set(rows.map((r) => r.reporter)).size };
}

async function forPark(request, env, park) {
  if (!PARK.test(park)) return json({ error: 'Which playground?' }, 400);
  const { results } = await env.PHOTOS_DB.prepare('SELECT reporter, conn, item, present FROM equipment_reports WHERE park = ?').bind(park).all();
  const me = parentFrom(request);
  const mine = results.filter((r) => r.reporter === me);
  const openRow = mine.find((r) => r.item === OPEN);
  return json({ ...summarise(results), mine: { items: mine.filter((r) => r.item !== OPEN).map((r) => r.item), open: openRow ? !!openRow.present : null } });
}

async function submit(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send your answers as JSON.' }, 400);
  }
  const park = String(body.park || '');
  const items = [...new Set((Array.isArray(body.items) ? body.items : []).map(String))].filter((k) => ITEMS.has(k));
  const open = body.open === true ? 1 : body.open === false ? 0 : null;
  if (!(await parkExists(request, env, park))) return json({ error: "We couldn't find that playground." }, 400);

  const conn = await connectionId(request);
  let parent = parentFrom(request);
  const headers = {};
  if (!parent) {
    parent = crypto.randomUUID();
    headers['Set-Cookie'] = `${COOKIE}=${parent}; Path=/api/equipment; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`;
  }
  const today = await env.PHOTOS_DB.prepare(
    "SELECT COUNT(DISTINCT park) AS n FROM equipment_reports WHERE conn = ? AND park != ? AND created_at > datetime('now', '-1 day')",
  ).bind(conn, park).first('n');
  if ((today ?? 0) >= PARKS_PER_DAY) return json({ error: "You've told us about a lot of playgrounds today. Thank you! Please try again tomorrow." }, 429, headers);

  const rows = [...items.map((k) => [k, 1]), ...(open == null ? [] : [[OPEN, open]])];
  await env.PHOTOS_DB.batch([
    env.PHOTOS_DB.prepare('DELETE FROM equipment_reports WHERE park = ? AND reporter = ?').bind(park, parent),
    ...rows.map(([item, present]) =>
      env.PHOTOS_DB.prepare('INSERT INTO equipment_reports (park, reporter, conn, item, present) VALUES (?, ?, ?, ?, ?)').bind(park, parent, conn, item, present),
    ),
  ]);
  const { results } = await env.PHOTOS_DB.prepare('SELECT reporter, conn, item, present FROM equipment_reports WHERE park = ?').bind(park).all();
  return json({ ...summarise(results), mine: { items, open: open == null ? null : !!open }, saved: rows.length }, 200, headers);
}

async function confirmedIndex(env) {
  const { results } = await env.PHOTOS_DB.prepare('SELECT park, reporter, conn, item, present FROM equipment_reports').all();
  const byPark = new Map();
  for (const r of results) byPark.set(r.park, [...(byPark.get(r.park) ?? []), r]);
  const parks = [...byPark].map(([park, rows]) => ({ park, ...summarise(rows) })).sort((a, b) => b.parents - a.parents || a.park.localeCompare(b.park));
  return json({ parks });
}

export async function equipment({ request, env, pathname }) {
  if (!env.PHOTOS_DB) return json({ error: 'This is not set up yet.' }, 503);
  const m = request.method;
  if (pathname === '/api/equipment') {
    if (m === 'GET') return forPark(request, env, new URL(request.url).searchParams.get('park') || '');
    if (m === 'POST') return submit(request, env);
    return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST' });
  }
  if (pathname === '/api/equipment/confirmed' || pathname === '/api/equipment/clear') {
    if (!env.MOD_TOKEN || !isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    if (pathname === '/api/equipment/confirmed' && m === 'GET') return confirmedIndex(env);
    if (pathname === '/api/equipment/clear' && m === 'POST') {
      const park = String((await request.json().catch(() => ({}))).park || '');
      if (!PARK.test(park)) return json({ error: 'Which playground?' }, 400);
      await env.PHOTOS_DB.prepare('DELETE FROM equipment_reports WHERE park = ?').bind(park).run();
      return json({ cleared: park });
    }
  }
  return json({ error: 'Not found.' }, 404);
}

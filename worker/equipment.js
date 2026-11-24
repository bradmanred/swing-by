// Parents tell us what a playground has, stored in the D1 database bound as PHOTOS_DB (table: db/equipment.sql).
//
// One parent's answers are never shown on their own. An item only appears on the playground page once at least
// two different parents (different browsers and different internet connections) have ticked it. The same goes
// for "Is this a public playground?": it needs two parents agreeing, and more saying so than saying otherwise.
//
// Public:
//   GET  /api/equipment?park=<id>    { confirmed: [codes], open: true | false | null, parents: n, mine: { items, open, other } }
//   GET  /api/equipment/open         { parks: [ids] } playgrounds two parents confirm are there (for "Hide unverified places")
//   POST /api/equipment              JSON { park, items: [codes], open: true | false | null, other: "rocking horse, ..." }
//                                    Replaces this browser's answers for that playground. An empty list, a null
//                                    "open" and no "other" withdraws them.
//
// "Other" is what parents type in for things that aren't on the tick list. It's never shown publicly. Anything
// that matches a tick-box name is counted as that tick box instead. The weekly tick-box review
// (scripts/other-equipment.mjs) reads the totals and suggests new tick boxes for things many parents mention.
// Moderators (Authorization: Bearer <MOD_TOKEN>):
//   GET  /api/equipment/confirmed    every playground with parent-confirmed answers, to fold into the playground files
//   GET  /api/equipment/other        what parents typed in, grouped: { other: [{ text, parents, parks, examples }] }
//   POST /api/equipment/clear        JSON { park } removes every parent answer for one playground (for abuse)
import labels from '../src/data/labels.json' with { type: 'json' };
import { isModerator } from './auth.js';
import { PARK, canonicalPark } from './ids.js';
import { SCHOOL_PAGES } from './school-grounds.js';

// What parents can tick: the equipment, access and facility lists used across the site, except toilets and
// baby change, which only come from official sources and the Toilet Map.
export const ITEMS = new Set([...Object.keys(labels.equipment), ...Object.keys(labels.access), ...Object.keys(labels.facilities)].filter((k) => !['wc', 'bc'].includes(k)));
// Tick-box names, lower case, so a typed "zip wire" or "Zip wires" counts as the tick box.
const BY_NAME = new Map(
  [...ITEMS].flatMap((k) => {
    const n = norm(labels.equipment[k] ?? labels.access[k] ?? labels.facilities[k]);
    return [[n, k], [n.replace(/ /g, ''), k]];
  }),
);
const OTHER_MAX = 3; // typed-in things per parent per playground
const OTHER_LEN = 40;
const OPEN = 'open'; // stored like an item: present 1 = a public playground is here, 0 = there isn't
const NEEDED = 2; // parents who must agree before an answer is shown
const PARKS_PER_DAY = 40; // per connection, to stop one person filling in the whole map
const COOKIE = 'sb_parent';
const YEAR = 60 * 60 * 24 * 365;

// Lower case, letters, numbers and spaces only, with a simple plural trimmed, so "Rocking horses!" and
// "rocking horse" group together.
export function norm(t) {
  let s = String(t ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(?:sh|ch|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (/[a-z]{3}s$/.test(s) && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);
  return s;
}
// Split what a parent typed into up to three tidy things. Returns { items: [tick-box codes], other: [texts] }.
export function parseOther(raw) {
  const items = [], other = [], seen = new Set();
  for (const part of String(raw ?? '').split(/[,;\n/]+/)) {
    const text = part.replace(/[^\p{L}\p{N} '&-]+/gu, ' ').replace(/\s+/g, ' ').replace(/^(?:an?|some|the)\s+/i, '').trim().slice(0, OTHER_LEN);
    const key = norm(text);
    if (key.length < 3 || !/[a-z]/.test(key) || seen.has(key)) continue;
    seen.add(key);
    const code = BY_NAME.get(key) ?? BY_NAME.get(key.replace(/ /g, ''));
    if (code) items.push(code);
    else if (other.length < OTHER_MAX) other.push(text);
  }
  return { items, other };
}

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

// A playground's id, or the old address of one taken off for being in school grounds (worker/school-grounds.js), whose
// page still asks parents whether it's public.
const parkOrSchool = async (request, env, given) => (await canonicalPark(request, env, given)) ?? (SCHOOL_PAGES.has(String(given ?? '')) ? String(given) : null);

async function forPark(request, env, given) {
  const park = await parkOrSchool(request, env, given);
  if (!park) return json({ error: 'Which playground?' }, 400);
  const { results } = await env.PHOTOS_DB.prepare('SELECT reporter, conn, item, present FROM equipment_reports WHERE park = ?').bind(park).all();
  const me = parentFrom(request);
  const mine = results.filter((r) => r.reporter === me);
  const openRow = mine.find((r) => r.item === OPEN);
  const other = me ? (await env.PHOTOS_DB.prepare('SELECT text FROM equipment_other WHERE park = ? AND reporter = ? ORDER BY id').bind(park, me).all()).results.map((r) => r.text) : [];
  return json({ ...summarise(results), mine: { items: mine.filter((r) => r.item !== OPEN).map((r) => r.item), open: openRow ? !!openRow.present : null, other } });
}

async function submit(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send your answers as JSON.' }, 400);
  }
  const park = await parkOrSchool(request, env, body.park);
  const typed = parseOther(Array.isArray(body.other) ? body.other.join(', ') : body.other);
  const items = [...new Set([...(Array.isArray(body.items) ? body.items : []).map(String), ...typed.items])].filter((k) => ITEMS.has(k));
  const open = body.open === true ? 1 : body.open === false ? 0 : null;
  if (!park) return json({ error: "We couldn't find that playground." }, 400);

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
    env.PHOTOS_DB.prepare('DELETE FROM equipment_other WHERE park = ? AND reporter = ?').bind(park, parent),
    ...typed.other.map((text) =>
      env.PHOTOS_DB.prepare('INSERT OR IGNORE INTO equipment_other (park, reporter, conn, text, norm) VALUES (?, ?, ?, ?, ?)').bind(park, parent, conn, text, norm(text)),
    ),
  ]);
  const { results } = await env.PHOTOS_DB.prepare('SELECT reporter, conn, item, present FROM equipment_reports WHERE park = ?').bind(park).all();
  return json({ ...summarise(results), mine: { items, open: open == null ? null : !!open, other: typed.other }, saved: rows.length + typed.other.length }, 200, headers);
}

// Every playground where parents agree there's a public playground, under the same two-parent rule. Public, so the
// finder can count them as verified; the answer is cached for a few minutes.
async function openIndex(env) {
  const { results } = await env.PHOTOS_DB.prepare("SELECT park, reporter, conn, item, present FROM equipment_reports WHERE item = 'open'").all();
  const byPark = new Map();
  for (const r of results) byPark.set(r.park, [...(byPark.get(r.park) ?? []), r]);
  const parks = [...byPark].filter(([, rows]) => summarise(rows).open === true).map(([park]) => park).sort();
  return json({ parks }, 200, { 'Cache-Control': 'public, max-age=300' });
}

async function confirmedIndex(env) {
  const { results } = await env.PHOTOS_DB.prepare('SELECT park, reporter, conn, item, present FROM equipment_reports').all();
  const byPark = new Map();
  for (const r of results) byPark.set(r.park, [...(byPark.get(r.park) ?? []), r]);
  const parks = [...byPark].map(([park, rows]) => ({ park, ...summarise(rows) })).sort((a, b) => b.parents - a.parents || a.park.localeCompare(b.park));
  return json({ parks });
}

// Everything parents have typed in, grouped by what they mean, most widely seen first. Counts each household
// once, like the tick boxes.
async function otherIndex(env) {
  const { results } = await env.PHOTOS_DB.prepare('SELECT park, reporter, conn, text, norm FROM equipment_other').all();
  const groups = new Map();
  for (const r of results) {
    const g = groups.get(r.norm) ?? { texts: new Map(), reporters: new Set(), conns: new Set(), parks: new Set() };
    g.texts.set(r.text, (g.texts.get(r.text) ?? 0) + 1);
    g.reporters.add(r.reporter);
    g.conns.add(r.conn);
    g.parks.add(r.park);
    groups.set(r.norm, g);
  }
  const other = [...groups].map(([key, g]) => ({
    key,
    text: [...g.texts].sort((a, b) => b[1] - a[1])[0][0],
    parents: Math.min(g.reporters.size, g.conns.size),
    parks: [...g.parks].sort(),
  }));
  other.sort((a, b) => b.parks.length - a.parks.length || b.parents - a.parents || a.key.localeCompare(b.key));
  return json({ other });
}

export async function equipment({ request, env, pathname }) {
  if (!env.PHOTOS_DB) return json({ error: 'This is not set up yet.' }, 503);
  const m = request.method;
  if (pathname === '/api/equipment') {
    if (m === 'GET') return forPark(request, env, new URL(request.url).searchParams.get('park') || '');
    if (m === 'POST') return submit(request, env);
    return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST' });
  }
  if (pathname === '/api/equipment/open') return m === 'GET' ? openIndex(env) : json({ error: 'Use GET.' }, 405, { Allow: 'GET' });
  if (pathname === '/api/equipment/confirmed' || pathname === '/api/equipment/clear' || pathname === '/api/equipment/other') {
    if (!env.MOD_TOKEN || !isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    if (pathname === '/api/equipment/confirmed' && m === 'GET') return confirmedIndex(env);
    if (pathname === '/api/equipment/other' && m === 'GET') return otherIndex(env);
    if (pathname === '/api/equipment/clear' && m === 'POST') {
      const given = String((await request.json().catch(() => ({}))).park || '');
      const park = (await canonicalPark(request, env, given)) ?? given;
      if (!PARK.test(park)) return json({ error: 'Which playground?' }, 400);
      await env.PHOTOS_DB.batch([
        env.PHOTOS_DB.prepare('DELETE FROM equipment_reports WHERE park = ?').bind(park),
        env.PHOTOS_DB.prepare('DELETE FROM equipment_other WHERE park = ?').bind(park),
      ]);
      return json({ cleared: park });
    }
  }
  return json({ error: 'Not found.' }, 404);
}

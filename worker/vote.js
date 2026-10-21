// "Where should we go next?" vote, stored in the D1 database bound as VOTES (see wrangler.jsonc and db/votes.sql).
// GET /api/vote  → { total, counts: { <area id>: n }, mine: <area id> | null }
// POST /api/vote → records or changes this browser's vote. Accepts JSON { area, other } from the page script,
//                  or a plain form post (no JavaScript), which is sent back to the home page.
//                  "other" is the place typed in when someone picks "Somewhere else". It's never shown publicly.
// GET /api/vote/suggestions → (moderators only) what people typed for "Somewhere else", grouped and counted.
// One vote per browser, remembered with a random cookie. It keeps honest families to one vote;
// it won't stop someone determined to vote twice, which is fine for a priorities poll.
import nextAreas from '../src/data/next-areas.json';
import { isModerator } from './auth.js';

const AREAS = new Set(nextAreas.areas.map((a) => a.id));
const COOKIE = 'sb_voter';
const YEAR = 60 * 60 * 24 * 365;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const voterFrom = (request) => {
  const id = /(?:^|;\s*)sb_voter=([0-9a-f-]{36})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1];
  return id ?? null;
};

async function results(env, voter) {
  const { results: rows } = await env.VOTES.prepare('SELECT area, COUNT(*) AS n FROM votes GROUP BY area').all();
  const counts = Object.fromEntries([...AREAS].map((id) => [id, 0]));
  for (const r of rows) if (AREAS.has(r.area)) counts[r.area] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mine = voter ? (await env.VOTES.prepare('SELECT area FROM votes WHERE voter = ?').bind(voter).first('area')) : null;
  return { total, counts, mine: mine ?? null };
}

// Group what people typed, ignoring case, spacing and a trailing county word, so "Kent" and "kent " count together.
async function suggestions(env) {
  const { results } = await env.VOTES.prepare("SELECT other FROM votes WHERE area = 'other' AND other IS NOT NULL").all();
  const groups = new Map();
  for (const { other } of results) {
    const key = other.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+(county|shire)$/, '').trim();
    if (!key) continue;
    const g = groups.get(key) ?? { name: other, votes: 0 };
    g.votes++;
    groups.set(key, g);
  }
  return json({ suggestions: [...groups.values()].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)) });
}

export async function vote({ request, env, pathname = '/api/vote' }) {
  if (!env.VOTES) return json({ error: 'Voting is not set up yet.' }, 503);
  if (pathname === '/api/vote/suggestions') {
    if (!env.MOD_TOKEN) return json({ error: 'Set the MOD_TOKEN secret on the Worker first.' }, 503);
    return isModerator(request, env) ? suggestions(env) : json({ error: 'Wrong moderator key.' }, 401);
  }
  let voter = voterFrom(request);

  if (request.method === 'GET') return json(await results(env, voter));
  if (request.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST' });

  // Only accept posts from this site, so other sites can't cast votes on a visitor's behalf.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Not allowed.' }, 403);

  const isForm = (request.headers.get('Content-Type') || '').includes('application/x-www-form-urlencoded');
  let area, other;
  try {
    const body = isForm ? Object.fromEntries(await request.formData()) : await request.json();
    area = body.area;
    other = String(body.other ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  } catch {
    area = null;
  }
  if (!AREAS.has(area)) return json({ error: 'Pick one of the areas listed.' }, 400);
  if (area !== 'other') other = '';
  else if (!other) return json({ error: 'Tell us where you\'d like us to go next.' }, 400);

  const isNew = !voter;
  if (isNew) voter = crypto.randomUUID();
  await env.VOTES.prepare(
    "INSERT INTO votes (voter, area, other) VALUES (?1, ?2, ?3) ON CONFLICT(voter) DO UPDATE SET area = ?2, other = ?3, updated_at = datetime('now')",
  )
    .bind(voter, area, other || null)
    .run();

  const cookie = isNew ? { 'Set-Cookie': `${COOKIE}=${voter}; Path=/api/vote; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax` } : {};
  if (isForm) return new Response(null, { status: 303, headers: { Location: '/?voted=1#vote-title', ...cookie } });
  return json(await results(env, voter), 200, cookie);
}

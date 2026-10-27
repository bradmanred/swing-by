// Parent photo uploads, stored in the D1 database bound as PHOTOS_DB (table: db/photos.sql).
//
// Every upload starts as "pending" and only appears on the site once a moderator approves it.
// Anyone can report an approved photo; a report hides it again until it's re-checked.
//
// Public:
//   GET  /api/photos?park=<id>         approved photos for one playground
//   GET  /api/photos/approved          the newest approved photo for every playground (for result cards)
//   GET  /api/photos/<id>/image        the image itself (approved photos only, unless moderating)
//   POST /api/photos                   multipart form: park, photo, credit, no_people, own_photo
//   POST /api/photos/<id>/report       hides the photo until a moderator looks again
// Moderators (Authorization: Bearer <MOD_TOKEN>, a secret set on the Worker):
//   GET  /api/photos/queue             pending and reported photos
//   POST /api/photos/<id>/review       JSON { decision: "approve" | "reject" }
// The weekly photo search (scripts/find-photos.mjs, same moderator key):
//   GET  /api/photos/search-status     when each playground was last searched, and which already have a photo
//   POST /api/photos/candidates        JSON { park, candidates: [{ source, source_url, image_url, licence, author, title, distance_m }] }
//                                      Openly licensed photos from Geograph or Wikimedia Commons. Each one is stored as
//                                      "pending" like a parent photo, so nothing shows until a moderator approves it.

import { isModerator } from './auth.js';
import { canonicalPark } from './ids.js';

const MAX_BYTES = 1_500_000; // the page shrinks photos to about 1600px before sending, well under this
const PER_HOUR = 5;
const PER_DAY = 20;
const ID = /^[0-9a-f-]{36}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const imageUrl = (id) => `/api/photos/${id}/image`;

// Only fetch found photos from the sources' own image servers.
const SOURCES = {
  geograph: /^https:\/\/([a-z0-9]+\.)?geograph\.org\.uk\//,
  commons: /^https:\/\/upload\.wikimedia\.org\//,
};
const OPEN_LICENCE = /^(CC0|CC BY(-SA)? \d(\.\d)?|Public domain)/i;
const MAX_PENDING_PER_PARK = 3;

/** The credit line for a photo, used on playground pages and cards. */
const creditFor = (r) =>
  r.source === 'geograph'
    ? `© ${r.author || 'Geograph contributor'}, ${r.licence || 'CC BY-SA 2.0'}, via Geograph`
    : r.source === 'commons'
      ? `${r.author || 'Wikimedia Commons contributor'}, ${r.licence}, via Wikimedia Commons`
      : `Shared by ${r.credit || 'a Swing By parent'}, CC BY 4.0`;

// Work out the real file type from its first bytes rather than trusting the browser.
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

// Uploaders are counted by a one-way hash of their IP address, only to limit how often they can upload.
async function uploaderId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`swing-by:${day}:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
}

const sameOrigin = (request) => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};

async function upload(request, env) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Send the photo as a form.' }, 400);
  }
  const park = await canonicalPark(request, env, form.get('park'));
  const file = form.get('photo');
  const credit = String(form.get('credit') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (form.get('no_people') !== 'yes' || form.get('own_photo') !== 'yes')
    return json({ error: 'Please confirm there are no people in the photo and that you took it.' }, 400);
  if (!park) return json({ error: "We couldn't find that playground." }, 400);
  if (!file || typeof file === 'string') return json({ error: 'Choose a photo first.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'That photo is too big. Try a smaller one.' }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return json({ error: 'Photos need to be JPEG, PNG or WebP.' }, 415);

  const who = await uploaderId(request);
  const recent = await env.PHOTOS_DB.prepare(
    "SELECT SUM(created_at > datetime('now', '-1 hour')) AS hour, COUNT(*) AS day FROM photos WHERE uploader = ? AND created_at > datetime('now', '-1 day')",
  )
    .bind(who)
    .first();
  if ((recent?.hour ?? 0) >= PER_HOUR || (recent?.day ?? 0) >= PER_DAY)
    return json({ error: "You've shared a lot of photos today. Thank you! Please try again later." }, 429);

  const width = Number(form.get('width')) || null;
  const height = Number(form.get('height')) || null;
  const id = crypto.randomUUID();
  await env.PHOTOS_DB.prepare(
    'INSERT INTO photos (id, park, credit, mime, width, height, bytes, image, uploader) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, park, credit || null, mime, width, height, bytes.length, bytes, who)
    .run();
  return json({ status: 'pending', message: "Thanks! We'll check your photo, and it will appear here once it's approved." }, 202);
}

async function forPark(request, env, given) {
  const park = await canonicalPark(request, env, given);
  if (!park) return json({ error: 'Unknown playground.' }, 400);
  const { results } = await env.PHOTOS_DB.prepare(
    "SELECT id, credit, width, height, created_at, source, source_url, licence, author FROM photos WHERE park = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 12",
  )
    .bind(park)
    .all();
  return json(
    {
      photos: results.map((r) => ({
        id: r.id,
        url: imageUrl(r.id),
        credit: r.credit,
        credit_line: creditFor(r),
        source: r.source,
        source_url: r.source_url,
        width: r.width,
        height: r.height,
        added: r.created_at.slice(0, 10),
      })),
    },
    200,
    { 'Cache-Control': 'no-cache' },
  );
}

async function approvedIndex(env) {
  const { results } = await env.PHOTOS_DB.prepare(
    "SELECT park, id, credit, source, licence, author FROM photos p WHERE status = 'approved' AND reviewed_at = (SELECT MAX(reviewed_at) FROM photos q WHERE q.park = p.park AND q.status = 'approved')",
  ).all();
  const out = {};
  for (const r of results) out[r.park] = { id: r.id, url: imageUrl(r.id), credit: creditFor(r) };
  return json(out, 200, { 'Cache-Control': 'no-cache' });
}

async function image(request, env, id) {
  const row = await env.PHOTOS_DB.prepare('SELECT status, mime, bytes, image FROM photos WHERE id = ?').bind(id).first();
  if (!row || !row.bytes || row.status === 'rejected' || (row.status !== 'approved' && !isModerator(request, env)))
    return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.image), {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': row.status === 'approved' ? 'public, max-age=300' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function report(request, env, id) {
  if (!sameOrigin(request)) return json({ error: 'Not allowed.' }, 403);
  await env.PHOTOS_DB.prepare(
    "UPDATE photos SET report_count = report_count + 1, status = CASE WHEN status = 'approved' THEN 'reported' ELSE status END WHERE id = ?",
  )
    .bind(id)
    .run();
  return json({ status: 'reported', message: "Thanks for telling us. We've hidden the photo until we've checked it." });
}

async function queue(env) {
  const { results } = await env.PHOTOS_DB.prepare(
    "SELECT id, park, status, credit, width, height, bytes, report_count, created_at, source, source_url, licence, author, title, distance_m FROM photos WHERE status IN ('pending', 'reported') ORDER BY source = 'parent' DESC, created_at LIMIT 100",
  ).all();
  return json({ photos: results.map((r) => ({ ...r, url: imageUrl(r.id) })) });
}

async function review(request, env, id) {
  let decision;
  try {
    decision = (await request.json()).decision;
  } catch {
    decision = null;
  }
  if (decision === 'approve') {
    await env.PHOTOS_DB.prepare("UPDATE photos SET status = 'approved', report_count = 0, reviewed_at = datetime('now') WHERE id = ?").bind(id).run();
  } else if (decision === 'reject') {
    // Rejected photos are deleted straight away; only the record that something was rejected is kept.
    await env.PHOTOS_DB.prepare("UPDATE photos SET status = 'rejected', image = X'', bytes = 0, reviewed_at = datetime('now') WHERE id = ?").bind(id).run();
  } else return json({ error: 'decision must be approve or reject.' }, 400);
  return json({ status: decision === 'approve' ? 'approved' : 'rejected' });
}

// For the weekly search: which playgrounds were searched when, and which already have a photo or suggestions waiting.
async function searchStatus(env) {
  const searched = (await env.PHOTOS_DB.prepare('SELECT park, searched_at FROM photo_searches').all()).results;
  const counts = (
    await env.PHOTOS_DB.prepare("SELECT park, SUM(status = 'approved') AS approved, SUM(status = 'pending') AS pending FROM photos GROUP BY park").all()
  ).results;
  return json({
    searched: Object.fromEntries(searched.map((r) => [r.park, r.searched_at])),
    photos: Object.fromEntries(counts.map((r) => [r.park, { approved: r.approved, pending: r.pending }])),
  });
}

async function candidates(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  const park = await canonicalPark(request, env, body.park);
  if (!park) return json({ error: "We couldn't find that playground." }, 400);
  const results = [];
  let pending =
    (await env.PHOTOS_DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE park = ? AND status = 'pending'").bind(park).first())?.n ?? 0;
  for (const c of (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 10)) {
    const source = String(c.source || '');
    const imageSrc = String(c.image_url || '');
    const pageUrl = String(c.source_url || '').slice(0, 300);
    const licence = String(c.licence || '').slice(0, 40);
    if (!SOURCES[source] || !SOURCES[source].test(imageSrc) || !/^https:\/\//.test(pageUrl) || !OPEN_LICENCE.test(licence)) {
      results.push({ source_url: pageUrl, status: 'skipped', reason: 'source or licence not allowed' });
      continue;
    }
    if (await env.PHOTOS_DB.prepare('SELECT 1 FROM photos WHERE source_url = ?').bind(pageUrl).first()) {
      results.push({ source_url: pageUrl, status: 'known' }); // already suggested, approved or rejected before
      continue;
    }
    if (pending >= MAX_PENDING_PER_PARK) {
      results.push({ source_url: pageUrl, status: 'skipped', reason: 'enough waiting for this playground' });
      continue;
    }
    const res = await fetch(imageSrc, { headers: { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; playground photos)' } }).catch(() => null);
    const bytes = res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    const mime = bytes ? sniff(bytes) : null;
    if (!bytes || !mime || bytes.length > MAX_BYTES) {
      results.push({ source_url: pageUrl, status: 'skipped', reason: 'image could not be fetched' });
      continue;
    }
    const id = crypto.randomUUID();
    await env.PHOTOS_DB.prepare(
      'INSERT INTO photos (id, park, credit, mime, width, height, bytes, image, uploader, source, source_url, licence, author, title, distance_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id, park, String(c.author || '').slice(0, 80) || null, mime, Number(c.width) || null, Number(c.height) || null, bytes.length, bytes,
        `import:${source}`, source, pageUrl, licence, String(c.author || '').slice(0, 80) || null, String(c.title || '').slice(0, 200) || null,
        Number.isFinite(Number(c.distance_m)) ? Math.round(Number(c.distance_m)) : null,
      )
      .run();
    pending++;
    results.push({ source_url: pageUrl, status: 'added' });
  }
  await env.PHOTOS_DB.prepare(
    "INSERT INTO photo_searches (park, searched_at, found) VALUES (?, datetime('now'), ?) ON CONFLICT(park) DO UPDATE SET searched_at = excluded.searched_at, found = excluded.found",
  )
    .bind(park, results.filter((r) => r.status === 'added').length)
    .run();
  return json({ results });
}

export async function photos({ request, env, pathname }) {
  if (!env.PHOTOS_DB) return json({ error: 'Photo sharing is not set up yet.' }, 503);
  const url = new URL(request.url);
  const parts = pathname.split('/').filter(Boolean); // ['api', 'photos', ...]
  const [, , a, b] = parts;
  const m = request.method;

  if (!a) {
    if (m === 'GET') return forPark(request, env, url.searchParams.get('park') || '');
    if (m === 'POST') return upload(request, env);
  } else if (a === 'approved' && m === 'GET') return approvedIndex(env);
  else if ((a === 'search-status' && m === 'GET') || (a === 'candidates' && m === 'POST')) {
    if (!env.MOD_TOKEN || !isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    return a === 'candidates' ? candidates(request, env) : searchStatus(env);
  }
  else if (a === 'queue' && m === 'GET') {
    if (!env.MOD_TOKEN) return json({ error: 'Set the MOD_TOKEN secret on the Worker to turn on moderation.' }, 503);
    return isModerator(request, env) ? queue(env) : json({ error: 'Wrong moderator key.' }, 401);
  } else if (ID.test(a)) {
    if (b === 'image' && m === 'GET') return image(request, env, a);
    if (b === 'report' && m === 'POST') return report(request, env, a);
    if (b === 'review' && m === 'POST') return isModerator(request, env) ? review(request, env, a) : json({ error: 'Wrong moderator key.' }, 401);
  }
  return json({ error: 'Not found.' }, 404);
}

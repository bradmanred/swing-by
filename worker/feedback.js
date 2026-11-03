// "How could we make Swing By better?" on the home page. Stored in the PHOTOS_DB D1 database (table in db/feedback.sql).
// POST /api/feedback        → saves a suggestion. Accepts JSON { message, website } from the page script, or a plain
//                             form post (no JavaScript), which is sent back to the home page.
//                             "website" is a field people never see: spam bots fill it in, so those posts are dropped.
// GET  /api/feedback/latest → (moderators only) the newest suggestions, for /moderate/.
// Suggestions are never shown on the site. We don't ask for names or email addresses.
import { isModerator } from './auth.js';

const MAX = 1000; // characters

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function feedback({ request, env, pathname = '/api/feedback' }) {
  if (!env.PHOTOS_DB) return json({ error: 'Feedback is not set up yet.' }, 503);

  if (pathname === '/api/feedback/latest') {
    if (!env.MOD_TOKEN) return json({ error: 'Set the MOD_TOKEN secret on the Worker first.' }, 503);
    if (!isModerator(request, env)) return json({ error: 'Wrong moderator key.' }, 401);
    const { results } = await env.PHOTOS_DB.prepare('SELECT message, created_at FROM feedback ORDER BY id DESC LIMIT 200').all();
    return json({ feedback: results });
  }

  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  // Only accept posts from this site, so other sites can't send suggestions on a visitor's behalf.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Not allowed.' }, 403);

  const isForm = (request.headers.get('Content-Type') || '').includes('application/x-www-form-urlencoded');
  let message = '', trap = '';
  try {
    const body = isForm ? Object.fromEntries(await request.formData()) : await request.json();
    message = String(body.message ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
    trap = String(body.website ?? '').trim();
  } catch {
    message = '';
  }
  if (message.length < 3) return json({ error: 'Tell us your idea first.' }, 400);
  if (message.length > MAX) return json({ error: `Keep it under ${MAX} characters.` }, 400);

  // A filled-in trap field means a bot: say thanks, keep nothing.
  if (!trap) await env.PHOTOS_DB.prepare('INSERT INTO feedback (message) VALUES (?)').bind(message).run();

  if (isForm) return new Response(null, { status: 303, headers: { Location: '/?thanks=1#feedback-title' } });
  return json({ ok: true });
}

// Playground pages packed into a few hundred files, to stay well under Cloudflare's 20,000 files per deploy on the
// free plan. Astro still builds every playground page as usual; scripts/pack-pages.mjs then moves each
// dist/playgrounds/<id>/index.html into dist/_pages/<n>.pack, and the Worker cuts the page back out when someone
// asks for /playgrounds/<id>/. The page's address and HTML are exactly as Astro built them.
//
// A pack file is one line of JSON, then the pages back to back:
//   {"some-park":[0,20512,"5f3a9c1e"],"another-park":[20512,19876,"0b77d2aa"]}\n<html…><html…>
// Each entry is [byte offset after the first line, byte length, ETag]. A page's pack is fixed by its id (packFor),
// so the Worker reads just one file per page. Shared by the Worker, the packing script and the tests.

/** How many pack files. About 18 pages each now; raise it (in one commit, with nothing else) if packs grow past ~3 MB. */
export const PACKS = 1000;
export const PACK_DIR = '_pages';

/** The pack a playground id lives in: a stable FNV-1a hash of the id. */
export function packFor(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PACKS;
}

/** The site path of pack n, e.g. /_pages/042.pack. */
export const packPath = (n) => `/${PACK_DIR}/${String(n).padStart(3, '0')}.pack`;

/** The page for id from a pack's bytes (Uint8Array), as { body: Uint8Array, etag }, or null if it isn't there. */
export function cutPage(bytes, id) {
  const nl = bytes.indexOf(10);
  if (nl < 0) return null;
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(0, nl)));
  const hit = index[id];
  if (!hit) return null;
  const [start, length, etag] = hit;
  return { body: bytes.subarray(nl + 1 + start, nl + 1 + start + length), etag };
}

/** Every id in a pack's bytes. */
export function packIds(bytes) {
  const nl = bytes.indexOf(10);
  return nl < 0 ? [] : Object.keys(JSON.parse(new TextDecoder().decode(bytes.subarray(0, nl))));
}

/** The playground id a path asks for (/playgrounds/<id>/), or null. Place pages under /playgrounds/in/ aren't packed. */
export function pageId(pathname) {
  const m = /^\/playgrounds\/([a-z0-9-]+)\/$/.exec(pathname);
  return m && m[1] !== 'in' ? m[1] : null;
}

/**
 * The Worker's side: the packed page for request as a Response, or null to fall through to the static files (an id
 * that isn't packed, or a build without packs). `assets` is the ASSETS binding.
 */
export async function servePacked(request, assets) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  // /playgrounds/<id> and /playgrounds/<id>/index.html redirect to /playgrounds/<id>/, as the static files did.
  const loose = /^\/playgrounds\/([a-z0-9-]+)(?:\/index\.html)?$/.exec(url.pathname);
  const id = pageId(url.pathname) ?? (loose && loose[1] !== 'in' ? loose[1] : null);
  if (!id) return null;
  const res = await assets.fetch(new Request(new URL(packPath(packFor(id)), url), { method: 'GET' }));
  if (!res.ok) return null;
  const page = cutPage(new Uint8Array(await res.arrayBuffer()), id);
  if (!page) return null;
  if (loose) {
    url.pathname = `/playgrounds/${id}/`;
    return new Response(null, { status: 307, headers: { Location: url.pathname + url.search } });
  }
  const etag = `"${page.etag}"`;
  // The same caching the static files get: browsers check back each time, and get a 304 if nothing changed.
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: etag };
  const match = request.headers.get('If-None-Match');
  if (match && match.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : page.body, { headers: { ...headers, 'Content-Length': String(page.body.length) } });
}

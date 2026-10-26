// Looks for openly licensed photos of playgrounds that don't have one yet, on Geograph (CC BY-SA 2.0) and
// Wikimedia Commons (CC BY, CC BY-SA, CC0 or public domain), and sends them to the site's moderation queue.
// Nothing appears on the site until a moderator approves it at /moderate/.
//
//   SITE=https://swing-by.co.uk MOD_TOKEN=… GEOGRAPH_KEY=… node scripts/find-photos.mjs [--limit 150] [--dry-run]
//
// Run weekly by .github/workflows/photos.yml. Without GEOGRAPH_KEY it searches Wikimedia Commons only.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SITE = process.env.SITE || 'https://swing-by.co.uk';
const TOKEN = process.env.MOD_TOKEN;
const GEOGRAPH_KEY = process.env.GEOGRAPH_KEY;
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 150; // playgrounds per run: Geograph asks for on-demand use, not bulk
const RADIUS_M = 200; // how far from the pin a photo can have been taken
const RESEARCH_DAYS = 60; // look again at playgrounds with nothing found after this long
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; finds openly licensed playground photos for moderation)' };
// Words that suggest a photo shows play equipment rather than just the park.
const PLAY = /\b(play ?(area|ground|park|equipment|space|trail|tower|structure|frame)|playgrounds?|children's swings|swings and|climbing frame|see-?saw|zip ?wire|adventure play|splash ?(pad|park)|toddler)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(url, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
      if (r.status === 429) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

async function geograph(p) {
  if (!GEOGRAPH_KEY) return [];
  const url = `https://api.geograph.org.uk/syndicator.php?key=${encodeURIComponent(GEOGRAPH_KEY)}&format=JSON&location=${p.lat},${p.lng}&distance=${RADIUS_M / 1000}&perpage=50`;
  const j = await getJson(url);
  const items = j?.items ?? [];
  if (DRY && items.length && !geograph.shown) {
    geograph.shown = true;
    console.log('Geograph item fields:', Object.keys(items[0]).join(', '));
  }
  return items
    .map((it) => {
      const lat = Number(it.lat ?? it.geo?.lat), lng = Number(it.long ?? it.lng ?? it.geo?.long);
      const thumb = String(it.thumb ?? it.thumbTag ?? '').match(/https?:\/\/[^"' ]+\.jpg/)?.[0] ?? '';
      const text = `${it.title ?? ''} ${strip(it.description)} ${it.tags ?? ''}`;
      return {
        source: 'geograph',
        source_url: String(it.link ?? it.guid ?? '').replace(/^http:/, 'https:'),
        // The 120px thumbnail URL without its size suffix is the standard 640px image.
        image_url: thumb.replace(/^http:/, 'https:').replace(/_\d+x\d+\.jpg$/, '.jpg'),
        licence: 'CC BY-SA 2.0',
        author: strip(it.author ?? it.realname ?? it.photographer),
        title: strip(it.title),
        distance_m: Number.isFinite(lat) && Number.isFinite(lng) ? Math.round(km(p, { lat, lng }) * 1000) : null,
        text,
      };
    })
    .filter((c) => c.source_url && c.image_url && (c.distance_m == null || c.distance_m <= RADIUS_M));
}

async function commons(p) {
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query', format: 'json', origin: '*', generator: 'geosearch', ggscoord: `${p.lat}|${p.lng}`, ggsradius: String(RADIUS_M),
      ggsnamespace: '6', ggslimit: '50', prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|mime', iiurlwidth: '1280',
    });
  const j = await getJson(url);
  return Object.values(j?.query?.pages ?? {})
    .map((pg) => {
      const ii = pg.imageinfo?.[0];
      const md = ii?.extmetadata ?? {};
      const c = pg.coordinates?.[0];
      return {
        source: 'commons',
        source_url: ii?.descriptionurl,
        image_url: ii?.thumburl || ii?.url,
        licence: strip(md.LicenseShortName?.value),
        author: strip(md.Artist?.value).slice(0, 80),
        title: strip(pg.title?.replace(/^File:/, '').replace(/\.\w+$/, '') || md.ObjectName?.value),
        distance_m: c ? Math.round(km(p, { lat: c.lat, lng: c.lon }) * 1000) : null,
        mime: ii?.mime,
        text: `${pg.title} ${strip(md.ImageDescription?.value)} ${strip(md.Categories?.value)}`,
      };
    })
    .filter((c) => c.source_url && c.image_url && /^image\/(jpeg|png|webp)$/.test(c.mime ?? '') && /^(CC0|CC BY(-SA)? \d|Public domain)/i.test(c.licence));
}

const parks = [];
for (const f of (await readdir('src/content/playgrounds')).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join('src/content/playgrounds', f), 'utf8'));
  if (!d.photo) parks.push({ id: f.replace(/\.json$/, ''), name: d.name, lat: d.lat, lng: d.lng });
}

// Stop with a plain message (shown as an error on the GitHub Actions run) rather than a stack trace.
const stop = (msg) => {
  console.log(`::error title=Find playground photos::${msg}`);
  process.exit(1);
};

let status = { searched: {}, photos: {} };
if (!DRY) {
  if (!TOKEN)
    stop('The MOD_TOKEN secret is missing. Add it under Settings > Secrets and variables > Actions > New repository secret, using the same moderator key as the Worker and /moderate/.');
  const r = await fetch(`${SITE}/api/photos/search-status`, { headers: { ...UA, Authorization: `Bearer ${TOKEN}` } }).catch(() => null);
  if (!r) stop(`Couldn't reach ${SITE}. Try again later.`);
  if (r.status === 401) stop("The site didn't accept MOD_TOKEN. Check the GitHub secret matches the MOD_TOKEN secret on the Worker exactly.");
  if (!r.ok) {
    // Show what came back, so a block in front of the Worker (Cloudflare's firewall or bot protection) can be
    // told apart from a problem in the Worker itself. The Worker always answers with JSON like {"error": "…"}.
    const body = strip(await r.text().catch(() => '')).slice(0, 300);
    const h = (name) => r.headers.get(name) || '-';
    console.log(`Response: ${r.status} ${r.statusText}. content-type: ${h('content-type')}, server: ${h('server')}, cf-ray: ${h('cf-ray')}, cf-mitigated: ${h('cf-mitigated')}`);
    console.log(`Body (first 300 characters): ${body || '(empty)'}`);
    let fromWorker = false;
    try {
      fromWorker = typeof JSON.parse(body).error === 'string';
    } catch {}
    if (fromWorker)
      stop(`${SITE}/api/photos/search-status answered ${r.status} from the Worker: ${body}. Has the latest site been deployed?`);
    stop(
      `${SITE}/api/photos/search-status answered ${r.status} but not from the Worker's own code, so it was most likely blocked before reaching it. ` +
        'In Cloudflare, open Security > Events and look for this request to see which rule stopped it, then add an exception for /api/photos/ requests that carry an Authorization header.',
    );
  }
  status = await r.json();
}
if (!GEOGRAPH_KEY) console.log('::warning title=Find playground photos::No GEOGRAPH_KEY secret, so only Wikimedia Commons was searched.');
const cutoff = Date.now() - RESEARCH_DAYS * 864e5;
const todo = parks
  .filter((p) => !(status.photos[p.id]?.approved > 0) && !(status.photos[p.id]?.pending >= 3))
  .filter((p) => !status.searched[p.id] || Date.parse(status.searched[p.id] + 'Z') < cutoff)
  .sort((a, b) => (status.searched[a.id] ? 1 : 0) - (status.searched[b.id] ? 1 : 0) || a.id.localeCompare(b.id))
  .slice(0, LIMIT);

let added = 0, sent = 0;
for (const p of todo) {
  const found = [...(await geograph(p)), ...(await commons(p))];
  // Photos that mention play equipment first, then the closest.
  found.sort((a, b) => Number(PLAY.test(b.text)) - Number(PLAY.test(a.text)) || (a.distance_m ?? 999) - (b.distance_m ?? 999));
  // Many Geograph photos are copied to Commons too: keep one copy of each.
  const seen = new Set();
  const picks = found
    .filter((c) => PLAY.test(c.text))
    .filter((c) => {
      const g = (c.source === 'geograph' ? c.source_url.match(/\/photo\/(\d+)/) : c.title.match(/geograph\.org\.uk - (\d+)/))?.[1];
      if (!g) return true;
      if (seen.has(g)) return false;
      seen.add(g);
      return true;
    })
    .slice(0, 3);
  if (DRY) {
    if (picks.length) console.log(p.id, picks.map((c) => `${c.source}: ${c.title} (${c.distance_m} m)`).join(' | '));
    continue;
  }
  const r = await getJson(`${SITE}/api/photos/candidates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ park: p.id, candidates: picks.map(({ text, mime, ...c }) => c) }),
  });
  sent++;
  added += r?.results?.filter((x) => x.status === 'added').length ?? 0;
  await sleep(1000);
}
console.log(`Searched ${todo.length} playgrounds without photos (${parks.length} in all). ${DRY ? 'Dry run.' : `Sent ${sent}; ${added} new photos are waiting at ${SITE}/moderate/.`}`);

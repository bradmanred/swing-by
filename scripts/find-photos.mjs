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
const PLAY = /\b(play ?(area|ground|park|equipment|space|trail|tower)|playground|swings?|slides?|climbing frame|see-?saw|roundabout|zip ?wire|adventure play|splash ?(pad|park))\b/i;
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
        title: strip(md.ObjectName?.value || pg.title?.replace(/^File:/, '')),
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

let status = { searched: {}, photos: {} };
if (!DRY) {
  if (!TOKEN) throw new Error('Set MOD_TOKEN (the moderator key) so suggestions can be sent to the site.');
  status = (await getJson(`${SITE}/api/photos/search-status`, { headers: { Authorization: `Bearer ${TOKEN}` } })) ?? status;
}
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
  const picks = found.filter((c) => PLAY.test(c.text)).slice(0, 3);
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

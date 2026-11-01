// Temporary (removed before merge): reads council park records for London part 3 into tmp/records.json.
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SwingBy/1.0; +https://swing-by.co.uk)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// curl gets through where Node's fetch is turned away by some councils' firewalls.
const get = async (u) => {
  for (let i = 0; i < 3; i++) {
    try {
      const body = execFileSync('curl', ['-sSL', '--fail', '--max-time', '40', '-A', UA['User-Agent'], u], { encoding: 'utf8', maxBuffer: 20e6 });
      if (body) return body;
    } catch {}
    await sleep(4000);
  }
  return '';
};
const getFetch = async (u) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(40000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return '';
    } catch {}
    await sleep(3000);
  }
  return '';
};
const strip = (s) =>
  String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<\/(li|p|dd|dt|h\d|tr|div)>/g, '; ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#x27;|&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/(;\s*){2,}/g, '; ')
    .trim();
const PC = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/;
const links = (html, base, re) => [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return ''; } }).filter((u) => re.test(u)))];
const out = [];
const extra = {};
const rec = (borough, url, html, more = {}) => {
  const t = strip(html);
  const c = html.match(/map_marker_location_\d+" value="(-?\d+\.\d+),(-?\d+\.\d+)"/) ?? html.match(/"features":\[\{"type":"point","lat":(-?[\d.]+),"lon":(-?[\d.]+)/) ?? html.match(/maps\/dir\/\/(-?\d+\.\d+),(-?\d+\.\d+)/) ?? html.match(/[@=](5\d\.\d{4,}),(-?\d\.\d{4,})/);
  out.push({ borough, url, h1: strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ''), lat: c ? Number(c[1]) : null, lng: c ? Number(c[2]) : null, postcode: t.match(PC)?.[1] ?? null, text: t.slice(0, 8000), ...more });
};
const crawlDir = async (borough, indexes, follow) => {
  const recs = new Set();
  for (const u of indexes) {
    links(await get(u), u, follow).forEach((x) => recs.add(x));
    await sleep(400);
  }
  console.log(`${borough}: ${recs.size} records`);
  return [...recs];
};

// Greenwich: the Playgrounds category (16), plus which records are in the paddling pool, cafe, toilets and gym categories.
{
  const base = 'https://www.royalgreenwich.gov.uk/directory/14/parks_gardens_and_open_spaces/category/';
  const follow = /royalgreenwich\.gov\.uk\/directory_record\/\d+\/[a-z0-9_]+$/;
  const pages = (c) => [0, 1, 2, 3, 4, 5].map((p) => `${base}${c}${p ? `?page=${p + 1}` : ''}`);
  for (const [c, name] of [[24, 'wp'], [263, 'cf'], [265, 'wc'], [31, 'gym']]) extra[`greenwich-${name}`] = await crawlDir(`Greenwich ${name}`, pages(c), follow);
  for (const u of await crawlDir('Greenwich', pages(16), follow)) {
    rec('Greenwich', u, await get(u));
    await sleep(500);
  }
}
// Haringey: the parks and facilities directory, every page.
{
  const idx = 'https://haringey.gov.uk/leisure-parks-culture/parks-greenspaces/parks-facilities-haringey';
  for (const u of await crawlDir('Haringey', [idx, `${idx}?page=1`, `${idx}?page=2`, `${idx}?page=3`], /parks-facilities-haringey\/[a-z0-9-]+$/)) {
    rec('Haringey', u, await get(u));
    await sleep(700);
  }
}
await writeFile('tmp/records-b.json', JSON.stringify({ extra, out }, null, 1));
console.log(`${out.length} records saved`);

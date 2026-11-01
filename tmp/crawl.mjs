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
  const at = html.search(/<h1[\s>]/);
  const t = strip(at > 0 ? html.slice(at) : html);
  const c = html.match(/map_marker_location_\d+" value="(-?\d+\.\d+),(-?\d+\.\d+)"/) ?? html.match(/"features":\[\{"type":"point","lat":(-?[\d.]+),"lon":(-?[\d.]+)/) ?? html.match(/maps\/dir\/\/(-?\d+\.\d+),(-?\d+\.\d+)/) ?? html.match(/[@=](5\d\.\d{4,}),(-?\d\.\d{4,})/);
  out.push({ borough, url, h1: strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ''), lat: c ? Number(c[1]) : null, lng: c ? Number(c[2]) : null, postcode: t.match(PC)?.[1] ?? null, text: t.slice(0, 8000), ...more });
};
const crawlDir = async (borough, indexes, follow) => {
  const recs = new Set();
  for (const u of indexes) {
    links(await get(u), u, follow).forEach((x) => recs.add(x.replace(/\/category\/.*$/, '').replace(/\?.*$/, '')));
    await sleep(400);
  }
  console.log(`${borough}: ${recs.size} records`);
  return [...recs];
};

// Greenwich: the Playgrounds category (16), plus which records are in the paddling pool, cafe, toilets and gym categories.
{
  const base = 'https://www.royalgreenwich.gov.uk/directory/14/parks_gardens_and_open_spaces/category/';
  const follow = /royalgreenwich\.gov\.uk\/directory_record\/\d+\/[a-z0-9_]+/;
  const pages = (c) => [0, 1, 2, 3, 4, 5].map((p) => `${base}${c}${p ? `?page=${p + 1}` : ''}`);
  for (const [c, name] of [[24, 'wp'], [263, 'cf'], [265, 'wc'], [31, 'gym']]) extra[`greenwich-${name}`] = await crawlDir(`Greenwich ${name}`, pages(c), follow);
  for (const u of await crawlDir('Greenwich', pages(16), follow)) {
    rec('Greenwich', u, await get(u));
    await sleep(500);
  }
}
// Lewisham: every park page linked from the parks index.
{
  const idx = 'https://lewisham.gov.uk/inmyarea/openspaces/parks';
  for (const u of await crawlDir('Lewisham', [idx], /lewisham\.gov\.uk\/inmyarea\/openspaces\/parks\/[a-z0-9-]+$/)) {
    rec('Lewisham', u, await get(u));
    await sleep(500);
  }
}
// Haringey: the parks and facilities directory, every page.
{
  const idx = 'https://haringey.gov.uk/leisure-parks-culture/parks-greenspaces/parks-facilities-haringey';
  const found = new Set(await crawlDir('Haringey', [idx, `${idx}?page=1`, `${idx}?page=2`, `${idx}?page=3`], /parks-facilities-haringey\/[a-z0-9-]+$/));
  for (const sm of ['https://haringey.gov.uk/sitemap.xml', 'https://haringey.gov.uk/sitemap.xml?page=1', 'https://haringey.gov.uk/sitemap.xml?page=2', 'https://haringey.gov.uk/sitemap.xml?page=3']) {
    for (const m of (await get(sm)).matchAll(/https?:\/\/(?:www\.)?haringey\.gov\.uk\/leisure-parks-culture\/parks-greenspaces\/parks-facilities-haringey\/[a-z0-9-]+/g)) found.add(m[0].replace('://www.', '://'));
  }
  console.log(`Haringey: ${found.size} records with the site map`);
  for (const u of found) {
    rec('Haringey', u, await get(u));
    await sleep(700);
  }
}
// Hounslow: the parks directory (its category 86 and A to Z), every record.
{
  const base = 'https://www.hounslow.gov.uk/directory/1010/parks-and-open-spaces-in-hounslow';
  const idx = [`${base}/category/86`, `${base}/category/86?page=2`, `${base}/category/86?page=3`, base, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L) => `${base}/a-to-z/${L}`)];
  for (const u of await crawlDir('Hounslow', idx, /hounslow\.gov\.uk\/directory-record\/\d+\//)) {
    rec('Hounslow', u, await get(u));
    await sleep(500);
  }
}
// Waltham Forest: the playgrounds page, and the park pages it and the parks pages link to.
{
  const base = 'https://www.walthamforest.gov.uk/libraries-arts-parks-and-leisure/parks-and-open-spaces';
  const pg = await get(`${base}/our-playgrounds`);
  rec('Waltham Forest', `${base}/our-playgrounds`, pg, { kind: 'list' });
  const idx = [`${base}/our-playgrounds`, `${base}/our-other-parks`, `${base}/our-open-spaces`, base];
  for (const u of await crawlDir('Waltham Forest', idx, /parks-and-open-spaces\/(?:our-open-spaces\/|our-other-parks\/)?[a-z0-9-]+$/)) {
    if (/our-playgrounds$|bee-friendly|parklets|green-schemes|strategies|resident-groups|volunteering|events|enjoying/.test(u)) continue;
    rec('Waltham Forest', u, await get(u));
    await sleep(500);
  }
}
// Harrow: the playground and gym equipment page, and each park page.
{
  const base = 'https://www.harrow.gov.uk/environment-parks/';
  rec('Harrow', `${base}playground-gym-equipment`, await get(`${base}playground-gym-equipment`), { kind: 'list' });
  for (const u of await crawlDir('Harrow', [`${base}commons-greens-open-space`, `${base}playground-gym-equipment`], /harrow\.gov\.uk\/environment-parks\/[a-z0-9-]+(?:\/\d+)?$/)) {
    if (!/park|recreation|gardens|common|green|field|wood|marsh/.test(u) || /report|host|memorial|protection|commons-greens|playground-gym/.test(u)) continue;
    rec('Harrow', u, await get(u));
    await sleep(500);
  }
}
await writeFile('tmp/records-c.json', JSON.stringify({ extra, out }, null, 1));
console.log(`${out.length} records saved`);

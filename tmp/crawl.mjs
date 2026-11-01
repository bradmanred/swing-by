// Temporary (removed before merge): reads council park records for the next London boroughs and saves the useful
// parts (name, address, postcode, coordinates if given, facilities text) to tmp/records.json.
import { writeFile } from 'node:fs/promises';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SwingBy/1.0; +https://swing-by.co.uk)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => {
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
    .replace(/<\/(li|p|dd|dt|h\d|tr)>/g, '; ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const PC = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/;
const links = (html, base, re) => [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), base).href).filter((u) => re.test(u)))];
const out = [];
const rec = (borough, url, html, extra = {}) => {
  const t = strip(html);
  const marker = html.match(/map_marker_location_\d+" value="(-?\d+\.\d+),(-?\d+\.\d+)"/) ?? html.match(/maps\/dir\/\/(-?\d+\.\d+),(-?\d+\.\d+)/) ?? html.match(/"lat(?:itude)?"\s*:\s*"?(-?5\d\.\d+)"?\s*,\s*"(?:lng|lon|longitude)"\s*:\s*"?(-?\d+\.\d+)/);
  const h1 = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '');
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  out.push({ borough, url, h1, title, lat: marker ? Number(marker[1]) : null, lng: marker ? Number(marker[2]) : null, postcode: t.match(PC)?.[1] ?? null, text: t.slice(0, 6000), ...extra });
};

// Bromley: A to Z pages, then every record.
{
  const recs = new Set();
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const h = await get(`https://www.bromley.gov.uk/directory/26/a-to-z/${L}`);
    links(h, 'https://www.bromley.gov.uk/', /bromley\.gov\.uk\/directory-record\/\d+\//).forEach((u) => recs.add(u));
    await sleep(500);
  }
  console.log(`Bromley: ${recs.size} records`);
  for (const u of recs) {
    rec('Bromley', u, await get(u));
    await sleep(600);
  }
}
// Hillingdon: the live "Local parks" page links every record.
{
  const h = await get('https://hillingdon.gov.uk/local-parks');
  const recs = links(h, 'https://hillingdon.gov.uk/', /hillingdon\.gov\.uk\/directory-record\/\d+\//);
  console.log(`Hillingdon: ${recs.length} records`);
  for (const u of recs) {
    rec('Hillingdon', u, await get(u));
    await sleep(600);
  }
}
// Wandsworth: the children's playgrounds section.
{
  const base = 'https://www.wandsworth.gov.uk/leisure-and-culture/parks-and-open-spaces/childrens-playgrounds/';
  const recs = links(await get(base), base, /childrens-playgrounds\/[a-z0-9-]+\/?$/);
  console.log(`Wandsworth: ${recs.length} playground pages`);
  for (const u of recs) {
    rec('Wandsworth', u, await get(u));
    await sleep(600);
  }
}
// Redbridge: area pages, then each park record.
{
  const recs = new Set();
  for (const a of ['fairlop-waters-country-park', 'goodmayes-and-chadwell-heath', 'hainault-and-newbury-park', 'hainault-forest', 'ilford-and-seven-kings', 'valentines-park', 'wanstead-barkingside-and-clayhall', 'woodford-and-south-woodford']) {
    const u = `https://www.redbridge.gov.uk/leisure-sport-and-the-arts/parks/${a}/`;
    const h = await get(u);
    links(h, u, /redbridge\.gov\.uk\/(discover\/directory|leisure-sport-and-the-arts\/parks\/[a-z0-9-]+)\/[a-z0-9-]+\/?$/).forEach((x) => recs.add(x));
    links(h, u, /redbridge\.gov\.uk\/discover\/directory\/[a-z0-9-]+\/?$/).forEach((x) => recs.add(x));
    await sleep(500);
  }
  console.log(`Redbridge: ${recs.size} records`);
  for (const u of recs) {
    rec('Redbridge', u, await get(u));
    await sleep(600);
  }
}
// Brent: park finder records, found through the site map.
{
  const recs = new Set();
  for (const sm of ['https://www.brent.gov.uk/sitemap.xml', 'https://www.brent.gov.uk/en/sitemap.xml', 'https://www.brent.gov.uk/sitemap']) {
    const x = await get(sm);
    [...x.matchAll(/https?:\/\/www\.brent\.gov\.uk\/(?:en\/)?parks-leisure-and-healthy-living\/parks-and-open-spaces\/park-finder\/[a-z0-9-]+/g)].forEach((m) => recs.add(m[0]));
    for (const child of [...x.matchAll(/<loc>([^<]*sitemap[^<]*)<\/loc>/g)].map((m) => m[1]).slice(0, 20)) {
      const y = await get(child);
      [...y.matchAll(/https?:\/\/www\.brent\.gov\.uk\/(?:en\/)?parks-leisure-and-healthy-living\/parks-and-open-spaces\/park-finder\/[a-z0-9-]+/g)].forEach((m) => recs.add(m[0]));
    }
    if (recs.size) break;
  }
  console.log(`Brent: ${recs.size} records`);
  for (const u of recs) {
    rec('Brent', u, await get(u));
    await sleep(600);
  }
}
await writeFile('tmp/records.json', JSON.stringify(out, null, 1));
console.log(`${out.length} records saved`);

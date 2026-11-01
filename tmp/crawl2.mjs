// Temporary (removed before merge): Redbridge's parks, from the council's area pages to Vision RCL's park pages.
import { writeFile } from 'node:fs/promises';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SwingBy/1.0; +https://swing-by.co.uk)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(40000) }); if (r.ok) return await r.text(); if (r.status === 404) return ''; } catch {} await sleep(3000); } return ''; };
const strip = (s) => String(s ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<\/(li|p|dd|dt|h\d|tr)>/g, '; ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const PC = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/;
const out = [];
const recs = new Map();
for (const a of ['fairlop-waters-country-park', 'goodmayes-and-chadwell-heath', 'hainault-and-newbury-park', 'hainault-forest', 'ilford-and-seven-kings', 'valentines-park', 'wanstead-barkingside-and-clayhall', 'woodford-and-south-woodford']) {
  const u = `https://www.redbridge.gov.uk/leisure-sport-and-the-arts/parks/${a}/`;
  const h = await get(u);
  for (const m of h.matchAll(/href="(https:\/\/visionrcl\.org\.uk\/centre\/[a-z0-9-]+\/?)"/g)) recs.set(m[1], a);
  await sleep(500);
}
console.log(`Redbridge: ${recs.size} parks on the area pages`);
const areaText = {};
for (const a of new Set(recs.values())) areaText[a] = strip(await get(`https://www.redbridge.gov.uk/leisure-sport-and-the-arts/parks/${a}/`)).slice(0, 20000);
for (const [u, area] of recs) {
  const slug = u.replace(/\/$/, '').split('/').pop();
  let h = '';
  let used = '';
  for (const s2 of [slug, `${slug}-park`, slug.replace(/-park$/, ''), slug.replace(/-recreation-ground$/, '-recreation-ground-park')]) {
    used = `https://www.redbridge.gov.uk/discover/directory/${s2}/`;
    h = await get(used);
    if (h && /Facilities|Map/.test(h)) break;
    h = '';
    await sleep(300);
  }
  const t = strip(h);
  out.push({ borough: 'Redbridge', area, vision: u, url: h ? used : null, h1: strip(h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ''), postcode: t.match(PC)?.[1] ?? null, text: t.slice(0, 5000) });
  await sleep(500);
}
await writeFile('tmp/records2.json', JSON.stringify({ areaText, out }, null, 1));
console.log(`${out.length} saved, ${out.filter((x) => x.url).length} with a council record`);

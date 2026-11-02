// Reads a council's own playground list, as described by a "feed" in src/data/council-sources.json:
// type 'jadu' or 'localgov' (the two common council website systems: just the directory's address, see
// scripts/council-readers.mjs), 'directory' (index pages, a regex for record links, regexes for the name and
// coordinates on each record page, and optionally "require", a regex a record page must match, such as a playground in
// its facilities list), or 'geojson' / 'csv' (url, name field, and lat/lng fields). Returns [{ name, lat, lng, url }],
// plus postcode, equipment, ages, access and facilities from the 'jadu' and 'localgov' readers. Parks whose page has
// no map point are placed from their postcode; ones with neither are left out.
// Used by scripts/find-gaps.mjs (adds new council-listed playgrounds) and scripts/quarterly-check.mjs (spots changes).
import { readJadu, readLocalGov } from './council-readers.mjs';

const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; reads council playground lists)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// "Church Meadows - Parks and recreation directory" or the other way round: keep the part that isn't the directory.
export const recordName = (s) => s.split(/\s+[-|]\s+/).find((part) => part && !/\bdirectory\b/i.test(part)) ?? s;
// "https://…/directory_record/1057478/church_meadows" → "Church Meadows". Empty if the address has no name in it.
export const slugName = (u) => {
  const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() ?? '');
  if (!/[a-z]/i.test(last) || /^\d+$/.test(last)) return '';
  return last.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (ch) => ch.toUpperCase()).trim();
};

/** Map points for postcodes, from postcodes.io (100 at a time). */
export async function postcodePoints(postcodes) {
  const out = {};
  const list = [...new Set(postcodes.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const res = await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: list.slice(i, i + 100) }) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    for (const x of res?.result ?? []) if (x.result) out[x.query] = { lat: x.result.latitude, lng: x.result.longitude };
  }
  return out;
}

export async function readFeed(feed) {
  if (feed.type === 'jadu' || feed.type === 'localgov') {
    const recs = await (feed.type === 'jadu' ? readJadu(feed) : readLocalGov(feed));
    const pts = await postcodePoints(recs.filter((r) => r.lat == null).map((r) => r.postcode));
    for (const r of recs)
      if (r.lat == null && pts[r.postcode]) Object.assign(r, pts[r.postcode], { from: 'postcode' });
      else if (r.lat != null) r.from = 'map';
    const placed = recs.filter((r) => r.lat != null);
    if (placed.length < recs.length) console.log(`  ${recs.length - placed.length} left out: no map point or postcode on the page`);
    return placed.map(({ text, ...r }) => r);
  }
  const recs = [];
  if (feed.type === 'directory') {
    const seen = new Set();
    for (const index of feed.index) {
      const html = await fetch(index, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      const links = [...html.matchAll(/href="([^"#]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), index).href).filter((u) => new RegExp(feed.follow).test(u));
      for (const u of links) {
        if (seen.has(u)) continue;
        seen.add(u);
        const page = await fetch(u, { headers: UA }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
        if (feed.require && !new RegExp(feed.require).test(page)) continue; // e.g. only parks whose facilities list a playground
        const c = page.match(new RegExp(feed.coords));
        const n = page.match(new RegExp(feed.name));
        if (c && n) recs.push({ name: recordName(strip(n[1])), lat: Number(c[1]), lng: Number(c[2]), url: u });
        await sleep(500);
      }
    }
    // A name shared by several records is the directory's own heading (e.g. "Parks and recreation directory"), not
    // the park's: use the name in the record's address instead (".../directory_record/1057478/church_meadows").
    const counts = new Map();
    for (const r of recs) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    for (const r of recs) if (counts.get(r.name) > 2 || /\bdirectory\b/i.test(r.name)) r.name = slugName(r.url) || r.name;
  } else if (feed.type === 'geojson') {
    const j = await fetch(feed.url, { headers: UA }).then((r) => r.json()).catch(() => null);
    for (const f of j?.features ?? []) {
      const [lng, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : [];
      if (lat != null) recs.push({ name: strip(f.properties?.[feed.nameField]), lat, lng, url: feed.page ?? feed.url });
    }
  } else if (feed.type === 'csv') {
    const text = await fetch(feed.url, { headers: UA }).then((r) => r.text()).catch(() => '');
    const [head, ...rows] = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
    const col = (k) => head.findIndex((h) => h.trim().replace(/"/g, '') === k);
    for (const r of rows) {
      const lat = Number(r[col(feed.latField)]), lng = Number(r[col(feed.lngField)]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) recs.push({ name: strip(r[col(feed.nameField)]?.replace(/"/g, '')), lat, lng, url: feed.page ?? feed.url });
    }
  }
  return recs.filter((x) => x.name);
}

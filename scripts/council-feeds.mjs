// Reads a council's own playground list, as described by a "feed" in src/data/council-sources.json:
// type 'directory' (index pages, a regex for record links, and regexes for the name and coordinates on each record
// page), or 'geojson' / 'csv' (url, name field, and lat/lng fields). Returns [{ name, lat, lng, url }].
// Used by scripts/find-gaps.mjs (adds new council-listed playgrounds) and scripts/quarterly-check.mjs (spots changes).
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; reads council playground lists)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function readFeed(feed) {
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
        const c = page.match(new RegExp(feed.coords));
        const n = page.match(new RegExp(feed.name));
        if (c && n) recs.push({ name: strip(n[1]).replace(/\s+[-|]\s.*$/, ''), lat: Number(c[1]), lng: Number(c[2]), url: u });
        await sleep(500);
      }
    }
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

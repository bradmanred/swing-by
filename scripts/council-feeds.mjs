// Reads a council's own playground list, as described by a "feed" in src/data/council-sources.json:
// type 'jadu' or 'localgov' (the two common council website systems: just the directory's address, see
// scripts/council-readers.mjs), 'directory' (index pages, a regex for record links, regexes for the name and
// coordinates on each record page, and optionally "require", a regex a record page must match, such as a playground in
// its facilities list), or 'geojson' / 'csv' (url, name field, and lat/lng fields). Returns [{ name, lat, lng, url }],
// plus postcode, equipment, ages, access and facilities from the 'jadu' and 'localgov' readers. Parks whose page has
// no map point are placed from their postcode; ones with neither are left out.
// type 'list' is for councils whose playgrounds are all on one page with no machine-readable version (Bexley's table,
// Westminster's playgrounds page): the rows are copied into a CSV in src/data/council-lists/ (name, postcode, url,
// and optionally text: the council's own description, used as the playground's description and from which equipment and facilities are picked out), and
// "page" names the council page they came from. Each row is placed from its postcode, then snapped onto the play area.
// Used by scripts/find-gaps.mjs (adds new council-listed playgrounds) and scripts/quarterly-check.mjs (spots changes).
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, readJadu, readLocalGov, readPages } from './council-readers.mjs';

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
  if (feed.type === 'jadu' || feed.type === 'localgov' || feed.type === 'pages') {
    const recs = await (feed.type === 'jadu' ? readJadu(feed) : feed.type === 'pages' ? readPages(feed) : readLocalGov(feed));
    // A name shared by several parks is the directory's own heading (Sutton's "Parks and facilities"): use the name in
    // the park's address instead.
    const counts = new Map();
    for (const r of recs) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    for (const r of recs) if (counts.get(r.name) > 2) r.name = slugName(r.url) || r.name;
    const pts = await postcodePoints(recs.filter((r) => r.lat == null).map((r) => r.postcode));
    for (const r of recs)
      if (r.lat == null && pts[r.postcode]) Object.assign(r, pts[r.postcode], { from: 'postcode' });
      else if (r.lat != null) r.from = 'map';
    await placeByParkName(recs, feed);
    const placed = recs.filter((r) => r.lat != null);
    if (placed.length < recs.length) console.log(`  ${recs.length - placed.length} left out: no map point or postcode on the page`);
    return placed.map(({ text, ...r }) => r);
  }
  if (feed.type === 'list') {
    const rows = parseCsv(await readFile(feed.file, 'utf8'));
    const pts = await postcodePoints(rows.map((r) => r.postcode?.toUpperCase().trim()));
    const out = [];
    for (const r of rows) {
      if (!r.name) continue;
      const at = pts[r.postcode?.toUpperCase().trim()];
      out.push({ name: r.name, lat: null, lng: null, ...(at && { ...at, from: 'postcode' }), postcode: r.postcode, url: r.url || feed.page, description: r.text ?? '', ...describe(r.text ?? '') });
    }
    await placeByParkName(out, feed);
    for (const r of out) if (r.lat == null) console.log(`  left out: ${r.name} (postcode ${r.postcode} not found, nor the park's name on OpenStreetMap)`);
    return out.filter((r) => r.lat != null);
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

/** Rows of a small CSV with a header line, as objects. Handles quoted fields with commas and doubled quotes. */
export function parseCsv(src) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell), (cell = '');
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const normName = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '').replace(/\b(the|play ?(ground|area)s?)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Parks whose page has neither a map point nor a postcode: find the park by name in the OpenStreetMap snapshot
 * (OSM_PARKS and OSM_PLAYGROUNDS, set by the osm-snapshot action), near the council's other parks or near feed.near ({ lat, lng }).
 * Only an exact name match within 12 km counts. The playground pin is then snapped onto the play area as usual.
 */
async function placeByParkName(recs, feed) {
  const todo = recs.filter((r) => r.lat == null);
  if (!todo.length || !process.env.OSM_PARKS) return;
  const load = async (file) => {
    try {
      const raw = await readFile(file);
      return JSON.parse((raw[0] === 0x1f ? gunzipSync(raw) : raw).toString()); // unpacked by the action, or still gzipped
    } catch {
      return [];
    }
  };
  // Named parks, and named playgrounds too ("Ifield Road Playground" is mapped as the playground itself).
  const parks = [...(await load(process.env.OSM_PARKS)), ...(process.env.OSM_PLAYGROUNDS ? (await load(process.env.OSM_PLAYGROUNDS)).filter((p) => p.tags?.name).map((p) => ({ ...p, name: p.tags.name })) : [])];
  if (!parks.length) return;
  const placed = recs.filter((r) => r.lat != null);
  const centre = feed.near ?? (placed.length ? { lat: placed.reduce((a, r) => a + r.lat, 0) / placed.length, lng: placed.reduce((a, r) => a + r.lng, 0) / placed.length } : null);
  if (!centre) return;
  const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const byName = new Map();
  for (const p of parks) if (km(p, centre) < 12) byName.set(normName(p.name), [...(byName.get(normName(p.name)) ?? []), p]);
  for (const r of todo) {
    const hits = (byName.get(normName(r.name)) ?? []).sort((a, b) => km(a, centre) - km(b, centre));
    if (hits.length) Object.assign(r, { lat: hits[0].lat, lng: hits[0].lng, from: 'park' });
  }
}

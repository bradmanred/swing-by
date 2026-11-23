// Quarterly check for changes to playgrounds already listed, without Claude. It changes no playground files: it
// writes a report of things a person (or the quarterly Claude task) should look at, in four parts.
//
//   1. Council lists: for councils with a machine-readable "feed" in src/data/council-sources.json, compares the
//      council's own list with the playgrounds we list for that council. Flags ones the council no longer lists,
//      ones whose name may have changed, and new ones on the council's list (the weekly coverage job adds those).
//      Also flags Unverified playgrounds listed from OpenStreetMap alone that are on the council's list, so they can
//      be verified with the council as source without waiting for the county's next coverage import.
//      And flags playgrounds removed for being inside school grounds (src/data/school-grounds.json) that are on the
//      council's list, so a person can confirm they're public and re-add them with the council as source.
//   2. OpenStreetMap: for playgrounds whose source is an OpenStreetMap page, checks the mapped playground is still
//      there, still tagged as a playground, and not now marked private.
//   3. Broken official links: checks each official source link still works. A page that's gone (404 or 410) often
//      means the council or operator has changed or removed the listing. Sites that block robots are ignored.
//   4. Not checked for a long time: playgrounds with an official source whose "checked" date is over a year old, or
//      missing.
//   5. Names and descriptions to improve: council playgrounds named "Village, Street" or "Village Street" (the
//      council's name is often the village plus a street, as with East Lothian's "Aberlady Pleasance", the play area
//      on The Pleasance), and council playgrounds with only the stock description and no equipment.
//
//   node scripts/quarterly-check.mjs                 everything (reports/quarterly-check.md and .json)
//   node scripts/quarterly-check.mjs --skip links    leave out a part: councils, osm, links, stale or names (comma-separated)
//
// Run by .github/workflows/quarterly-check.yml, which posts the report as a GitHub issue.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFeed } from './council-feeds.mjs';
import { linkStatus } from './link-status.mjs';
import { SCHOOL_GROUNDS } from './osm-details.mjs';

const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const DIR = arg('--dir', 'src/content/playgrounds');
const OUT = arg('--out', 'reports');
const SKIP = new Set(arg('--skip', '').split(',').filter(Boolean));
const STALE_DAYS = Number(arg('--stale-days', 365));
const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; quarterly check of playground sources)' };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SITE = 'https://swing-by.co.uk/playgrounds/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metres = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const GENERIC = new Set('play area areas playground playgrounds park parks recreation ground grounds playing field fields the and of off road street close lane avenue drive way green common open space'.split(' '));
const words = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w)));
const sharesWord = (a, b) => [...words(a)].some((w) => words(b).has(w));
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const OSM_RE = /openstreetmap\.org\/(node|way|relation)\/(\d+)/;
// Photo sites are credited as sources but aren't official ones, so they don't count for the "not checked" list.
const PHOTO_RE = /(?:geograph\.org\.uk|commons\.wikimedia\.org)\//;
const official = (s) => !OSM_RE.test(s.url) && !PHOTO_RE.test(s.url);
const link = (p) => `[${p.name}](${SITE}${p.id}/)`;

// The playground files.
const parks = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  parks.push({ id: f.replace(/\.json$/, ''), ...d, sources: d.sources ?? [] });
}
console.log(`${parks.length} playgrounds`);
const osmOnly = parks.filter((p) => !p.checked && p.sources.length && p.sources.every((s) => OSM_RE.test(s.url)));
const result = { councils: [], osm: { gone: [], retagged: [], private: [], checked: 0 }, links: { broken: [], checked: 0 }, stale: [], names: [], thin: [] };

// 1. Council lists.
if (!SKIP.has('councils')) {
  const { councils } = JSON.parse(await readFile(arg('--councils', 'src/data/council-sources.json'), 'utf8'));
  for (const c of councils.filter((c) => c.feed)) {
    console.log(`Council list: ${c.council}`);
    const recs = await readFeed(c.feed).catch(() => []);
    const hosts = new Set([...(c.sources ?? []), c.feed.url, c.feed.page, c.feed.directory, ...(c.feed.index ?? [])].filter(Boolean).map(host));
    const ours = parks.filter((p) => (p.operator ?? '').toLowerCase().includes(c.council.toLowerCase()) || p.sources.some((s) => hosts.has(host(s.url))));
    const r = { council: c.council, listed: recs.length, ours: ours.length, gone: [], renamed: [], fresh: [], verify: [], school: [] };
    if (!recs.length) r.error = "Couldn't read the council's list (it may have moved or changed format): check the feed in council-sources.json.";
    else {
      for (const p of ours) {
        const near = recs.map((x) => ({ x, d: metres(p, x) })).sort((a, b) => a.d - b.d)[0];
        const byName = recs.find((x) => sharesWord(x.name, p.name));
        if (!near || (near.d > 150 && !byName)) r.gone.push(p);
        else if (near.d <= 60 && !sharesWord(near.x.name, p.name) && !byName) r.renamed.push({ p, now: near.x.name });
      }
      for (const x of recs) {
        if (ours.some((p) => metres(p, x) <= 150 || sharesWord(x.name, p.name))) continue;
        // One we removed for being inside school grounds (src/data/school-grounds.json), now on the council's list.
        const school = [...SCHOOL_GROUNDS].find(([, s]) => metres(s, x) <= 150);
        if (school) {
          r.school.push({ x, osm: school[0], was: school[1] });
          continue;
        }
        // An Unverified OpenStreetMap-only listing of the same place: the nearest within 150 m, or one sharing a word
        // of the council's name within 400 m.
        const near = osmOnly.map((p) => ({ p, d: metres(p, x) })).filter(({ p, d }) => d <= 150 || (d <= 400 && sharesWord(x.name, p.name))).sort((a, b) => a.d - b.d)[0];
        if (near && !r.verify.some((v) => v.p.id === near.p.id)) r.verify.push({ p: near.p, x, d: Math.round(near.d) });
        else r.fresh.push(x);
      }
    }
    result.councils.push(r);
  }
}

// 2. OpenStreetMap.
async function overpass(q) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: 'POST', headers: UA, body: new URLSearchParams({ data: q }) });
      if (r.ok) return (await r.json()).elements;
      console.log(`  Overpass answered ${r.status}, trying again`);
    } catch (e) {
      console.log(`  Overpass failed (${e.message}), trying again`);
    }
    await sleep(20000);
  }
  return null;
}
if (!SKIP.has('osm')) {
  const mapped = parks
    .map((p) => ({ p, m: p.sources.map((s) => s.url.match(OSM_RE)).find(Boolean) }))
    .filter((x) => x.m)
    .map(({ p, m }) => ({ p, type: m[1], id: m[2] }));
  console.log(`OpenStreetMap: ${mapped.length} playgrounds sourced from it`);
  for (let i = 0; i < mapped.length; i += 400) {
    const batch = mapped.slice(i, i + 400);
    const ids = (t) => batch.filter((x) => x.type === t).map((x) => x.id);
    const parts = ['node', 'way', 'relation'].filter((t) => ids(t).length).map((t) => `${t}(id:${ids(t).join(',')});`);
    const els = await overpass(`[out:json][timeout:180];(${parts.join('')});out tags;`);
    if (!els) {
      result.osm.error = "OpenStreetMap couldn't be reached for some playgrounds, so this part is incomplete.";
      continue;
    }
    const got = new Map(els.map((e) => [`${e.type}/${e.id}`, e.tags ?? {}]));
    for (const x of batch) {
      result.osm.checked++;
      const t = got.get(`${x.type}/${x.id}`);
      if (!t) result.osm.gone.push(x);
      else if (t.leisure !== 'playground') result.osm.retagged.push({ ...x, now: Object.entries(t).filter(([k]) => ['leisure', 'disused:leisure', 'was:leisure', 'name'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ') || 'no playground tag' });
      else if (t.access === 'private' || t.access === 'no') result.osm.private.push(x);
    }
    console.log(`  ${Math.min(i + 400, mapped.length)} of ${mapped.length}`);
    await sleep(3000);
  }
}

// 3. Broken official links (not OpenStreetMap pages, which part 2 covers).
if (!SKIP.has('links')) {
  const urls = new Map();
  for (const p of parks) for (const s of p.sources) if (!OSM_RE.test(s.url) && /^https?:/.test(s.url)) urls.set(s.url, [...(urls.get(s.url) ?? []), p]);
  console.log(`Official links: ${urls.size}`);
  const list = [...urls.keys()];
  const status = (u) => linkStatus(u, { headers: UA });
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < list.length) {
        const u = list[next++];
        const s = await status(u);
        result.links.checked++;
        if (s === 404 || s === 410) result.links.broken.push({ url: u, status: s, parks: urls.get(u) });
      }
    }),
  );
}

// 4. Not checked for a long time.
if (!SKIP.has('stale')) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  result.stale = parks
    .filter((p) => !p.membership && p.sources.some(official) && (!p.checked || p.checked < cutoff))
    .sort((a, b) => String(a.checked ?? '').localeCompare(String(b.checked ?? '')));
}

// 5. Names and descriptions to improve (no network needed).
if (!SKIP.has('names')) {
  const STOCK = /^A playground on .+'s own list of play areas\.$/;
  // The rest of the name already says what kind of place it is ("Park Playground", "Road Play Area", "No.2"): leave it.
  const TYPED = /\b(play\w*|parks?|grounds?|rec\w*|fields?|greens?|gardens?|commons?|centre|school|college|hall|road|lane|street|avenue|drive|close|way|wood|vale|lock|springs?|north|south|east|west|upper|lower|no\.?\s*\d+|\d+|splash|skate|mua|muga|estate)\b/i;
  for (const p of parks) {
    if (!p.checked || p.membership || !p.sources.some(official)) continue;
    const town = String(p.area ?? '').split(',')[0].trim();
    const rest = town && p.name.toLowerCase().startsWith(town.toLowerCase()) ? p.name.slice(town.length).replace(/^[,\s]+/, '') : '';
    if (rest && /^[A-Z]/.test(rest) && rest.split(/\s+/).length <= 2 && !TYPED.test(rest)) result.names.push({ p, rest });
    if (STOCK.test(p.description ?? '') && !(p.equipment ?? []).length) result.thin.push(p);
  }
  result.thin.sort((a, b) => String(a.area).localeCompare(String(b.area)) || a.name.localeCompare(b.name));
}

// The report.
const MAX = 40; // per list, so the issue stays within GitHub's size limit (the full lists are in the .json)
const more = (n) => (n > MAX ? [`- …and ${n - MAX} more (see quarterly-check.json in the run's artifacts)`] : []);
const L = [`# Quarterly playground check, ${new Date().toISOString().slice(0, 10)}`, ''];
L.push('Things to look at. Nothing has been changed: check each against its official source before editing or removing a playground.', '');
L.push('## Summary', '');
const c = result.councils;
if (!SKIP.has('councils')) L.push(`- **Council lists:** ${c.length} read; ${c.reduce((a, r) => a + r.gone.length, 0)} playgrounds no longer on the council's list, ${c.reduce((a, r) => a + r.renamed.length, 0)} possibly renamed, ${c.reduce((a, r) => a + r.fresh.length, 0)} new on the council's list, ${c.reduce((a, r) => a + r.verify.length, 0)} Unverified playgrounds now on a council's list, ${c.reduce((a, r) => a + r.school.length, 0)} removed from school grounds but now on a council's list`);
if (!SKIP.has('councils')) L.push(`- **Removed from school grounds, waiting for an official source:** ${SCHOOL_GROUNDS.size} (src/data/school-grounds.json). When checking an area's council or parish lists by hand, look for these too.`);
if (!SKIP.has('osm')) L.push(`- **OpenStreetMap:** ${result.osm.checked} checked; ${result.osm.gone.length} deleted, ${result.osm.retagged.length} no longer tagged as a playground, ${result.osm.private.length} now private`);
if (!SKIP.has('links')) L.push(`- **Official links:** ${result.links.checked} checked; ${result.links.broken.length} broken`);
if (!SKIP.has('stale')) L.push(`- **Not checked for over a year (or never):** ${result.stale.length} playgrounds with an official source`);
if (!SKIP.has('names')) L.push(`- **Names and descriptions:** ${result.names.length} names that may be "village + street", ${result.thin.length} council playgrounds with only the stock description`);
if (!SKIP.has('councils')) {
  L.push('', '## 1. Council lists', '');
  if (!c.length) L.push('No councils have a machine-readable list yet.');
  for (const r of c) {
    L.push(`### ${r.council}`, '', r.error ?? `${r.listed} on the council's list, ${r.ours} listed by us.`, '');
    if (r.gone.length) L.push('No longer on the council\'s list (closed, removed or moved?):', ...r.gone.slice(0, MAX).map((p) => `- ${link(p)}`), ...more(r.gone.length), '');
    if (r.renamed.length) L.push('Possibly renamed:', ...r.renamed.slice(0, MAX).map((x) => `- ${link(x.p)}: the council now says "${x.now}"`), ...more(r.renamed.length), '');
    if (r.verify.length) L.push("Unverified (listed from OpenStreetMap only) but on the council's list: add the council as source and a checked date:", ...r.verify.slice(0, MAX).map((v) => `- ${link(v.p)}: the council lists [${v.x.name}](${v.x.url}) ${v.d} m away`), ...more(r.verify.length), '');
    if (r.school.length) L.push("Removed in November 2026 for being inside school grounds, but on the council's list: check it's open to everyone, then re-add it with the council as source and delete its entry from src/data/school-grounds.json:", ...r.school.slice(0, MAX).map((v) => `- [${v.x.name}](${v.x.url}): was ${v.was.name}, ${v.was.area} ([${v.osm}](https://www.openstreetmap.org/${v.osm}))`), ...more(r.school.length), '');
    if (r.fresh.length) L.push("New on the council's list (the weekly coverage job adds these):", ...r.fresh.slice(0, MAX).map((x) => `- [${x.name}](${x.url})`), ...more(r.fresh.length), '');
  }
}
if (!SKIP.has('osm')) {
  const osmLine = (x) => `- ${link(x.p)}: [${x.type}/${x.id}](https://www.openstreetmap.org/${x.type}/${x.id})${x.now ? ` (now ${x.now})` : ''}`;
  L.push('', '## 2. OpenStreetMap', '');
  if (result.osm.error) L.push(result.osm.error, '');
  if (result.osm.gone.length) L.push('Deleted from OpenStreetMap (the playground may have gone):', ...result.osm.gone.slice(0, MAX).map(osmLine), ...more(result.osm.gone.length), '');
  if (result.osm.retagged.length) L.push('No longer tagged as a playground:', ...result.osm.retagged.slice(0, MAX).map(osmLine), ...more(result.osm.retagged.length), '');
  if (result.osm.private.length) L.push('Now marked private:', ...result.osm.private.slice(0, MAX).map(osmLine), ...more(result.osm.private.length), '');
  if (!result.osm.gone.length && !result.osm.retagged.length && !result.osm.private.length && !result.osm.error) L.push('Nothing changed.');
}
if (!SKIP.has('links')) {
  L.push('', '## 3. Broken official links', '');
  L.push(...(result.links.broken.length ? result.links.broken.slice(0, MAX).map((b) => `- ${b.url} (${b.status}), used by ${b.parks.slice(0, 5).map(link).join(', ')}${b.parks.length > 5 ? ` and ${b.parks.length - 5} more` : ''}`) : ['None.']), ...more(result.links.broken.length));
}
if (!SKIP.has('stale')) {
  L.push('', '## 4. Not checked for over a year', '', 'Oldest first. The quarterly Claude task works through these; membership playgrounds have their own check.', '');
  L.push(...(result.stale.length ? result.stale.slice(0, MAX).map((p) => `- ${link(p)}: ${p.checked ? `checked ${p.checked}` : 'never checked'}`) : ['None.']), ...more(result.stale.length));
}
if (!SKIP.has('names')) {
  L.push('', '## 5. Names and descriptions to improve', '');
  L.push('Names that start with their village or town. Check what the rest refers to: often a street, so "Aberlady, Pleasance" becomes "The Pleasance play area".', '');
  L.push(...(result.names.length ? result.names.slice(0, MAX).map((x) => `- ${link(x.p)}: "${x.rest}" in ${x.p.area}`) : ['None.']), ...more(result.names.length));
  L.push('', 'Council playgrounds with only the stock description and no equipment. Look for details in the council\'s own sources (news releases, play strategy or play sufficiency documents).', '');
  L.push(...(result.thin.length ? result.thin.slice(0, MAX).map((p) => `- ${link(p)}`) : ['None.']), ...more(result.thin.length));
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'quarterly-check.md'), L.join('\n') + '\n');
const slim = (p) => ({ id: p.id, name: p.name, checked: p.checked ?? null });
await writeFile(
  join(OUT, 'quarterly-check.json'),
  JSON.stringify(
    {
      councils: result.councils.map((r) => ({ ...r, school: r.school.map((v) => ({ council: v.x.name, url: v.x.url, osm: v.osm, was: v.was.page })), gone: r.gone.map(slim), renamed: r.renamed.map((x) => ({ ...slim(x.p), now: x.now })), verify: r.verify.map((v) => ({ ...slim(v.p), council: v.x.name, url: v.x.url, metres: v.d })) })),
      osm: { ...result.osm, gone: result.osm.gone.map((x) => ({ ...slim(x.p), osm: `${x.type}/${x.id}` })), retagged: result.osm.retagged.map((x) => ({ ...slim(x.p), osm: `${x.type}/${x.id}`, now: x.now })), private: result.osm.private.map((x) => ({ ...slim(x.p), osm: `${x.type}/${x.id}` })) },
      links: { ...result.links, broken: result.links.broken.map((b) => ({ ...b, parks: b.parks.map(slim) })) },
      stale: result.stale.map(slim),
      names: result.names.map((x) => ({ ...slim(x.p), rest: x.rest })),
      thin: result.thin.map(slim),
    },
    null,
    1,
  ),
);
console.log(L.slice(0, 9).join('\n'));

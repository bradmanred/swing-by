// Ready-made readers for the two website systems most councils use for their parks directories, so adding a
// council needs only a feed entry in src/data/council-sources.json, not hand-written patterns:
//
//   { "type": "jadu", "directory": "https://www.hounslow.gov.uk/directory/1010/parks-and-open-spaces-in-hounslow",
//     "category": 86 }
//     Jadu directories (addresses like /directory/26/... with /directory-record/123/ or /directory_record/123/ pages),
//     as used by Bromley, Greenwich, Hounslow, Rotherham and Reigate and Banstead. With "category" (a number, or a
//     list of them) only that category's pages are read; without one, the whole A to Z. Either way only parks whose
//     page mentions a playground or play area are kept, unless "allPlay": true says every record is a playground (a
//     council's own playgrounds category).
//
//   { "type": "localgov", "directory": "https://www.croydon.gov.uk/.../parks-and-playgrounds-directory",
//     "query": "localgov_directories_facets_proximity_search%5B152%5D=152" }
//     LocalGov Drupal directories (a list page with ?page=0, 1, 2… and one page per park under it), as used by Croydon
//     and Haringey. "query" is an optional filter (such as a playground facet) added to every list page.
//
// { "type": "pages", "index": [list pages], "follow": "regex for park page addresses" } does the same for any other
// website whose park list links to one page per park (Richmond, Kensington and Chelsea, Islington).
//
// Optional for all three: "nameFrom": "title" (the park's name is in the page title, not its heading), "allPlay", "require" (a regex a park's page must match, replacing the playground test), "approximate"
// (the map point is the park's, not the play area's), "include"/"exclude" (regexes on the park's name).
//
// Each record: { name, lat, lng, postcode, url, equipment, ages, access, facilities, text }. lat/lng are null when
// the page has no map point; find-gaps.mjs then places it from the postcode. equipment, ages, access and facilities
// use the codes in src/data/labels.json, picked out of the council's own wording (see describe()).
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (compatible; SwingBy/1.0; +https://swing-by.co.uk)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PAGES = 30;

/** A page's HTML, or '' if it can't be had. Some council firewalls turn away Node's fetch but accept curl. */
export async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(40000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return '';
    } catch {}
    try {
      const body = execFileSync('curl', ['-sSL', '--fail', '--max-time', '40', '-A', UA, url], { encoding: 'utf8', maxBuffer: 20e6, stdio: ['ignore', 'pipe', 'ignore'] });
      if (body) return body;
    } catch {}
    await sleep(3000);
  }
  return '';
}

/** Page text with tags removed, keeping list items and table cells apart. */
export const text = (html) =>
  String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(li|p|dd|dt|h\d|tr|td|th|div)>/gi, '; ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#x27;|&#8217;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .replace(/(;\s*){2,}/g, '; ')
    .trim();

const links = (html, base) =>
  [...String(html).matchAll(/href="([^"#]+)"/g)].map((m) => {
    try {
      return new URL(m[1].replace(/&amp;/g, '&'), base).href;
    } catch {
      return '';
    }
  });

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/;
const PLAY = /\bplay ?(?:ground|area|park|space)s?\b|\bchildren'?s play\b|\badventure playground\b/i;

/** The park's map point, from the markers Jadu and LocalGov Drupal put on record pages. */
export function point(html) {
  const c =
    html.match(/map_marker_location_\d+" value="(-?\d+\.\d+),\s*(-?\d+\.\d+)"/) ??
    html.match(/"type":"point","lat":"?(-?[\d.]+)"?,"lon":"?(-?[\d.]+)/) ??
    html.match(/data-lat(?:itude)?="(-?\d+\.\d+)"[^>]*data-(?:lng|lon|longitude)="(-?\d+\.\d+)"/) ??
    html.match(/maps\/dir\/\/(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!c) return null;
  const lat = Number(c[1]), lng = Number(c[2]);
  // Only points in the UK and Ireland (some pages put longitude first).
  if (lat > 49 && lat < 61 && lng > -11 && lng < 2.5) return { lat, lng };
  if (lng > 49 && lng < 61 && lat > -11 && lat < 2.5) return { lat: lng, lng: lat };
  return null;
}

// Council wording → the codes in src/data/labels.json. Only plain mentions count; "no toilets" and the like don't.
const WORDS = {
  equipment: [
    ['bs', /\b(?:baby|toddler|cradle|infant) swings?\b/i],
    ['bk', /\b(?:basket|nest|team|group|bird'?s? nest) swings?\b/i],
    ['sw', /\bswings?\b/i],
    ['sl', /\bslides?\b/i],
    ['cl', /\bclimbing (?:frames?|units?|structures?|nets?|walls?)\b|\bclimbing\b/i],
    ['zw', /\bzip ?wires?\b|\bzipwires?\b|\baerial runways?\b|\bcable ?ways?\b/i],
    ['sp', /\bsand ?pits?\b|\bsand play\b/i],
    ['wp', /\bwater play\b|\bsplash (?:pad|park|play)s?\b|\bpaddling pools?\b/i],
    ['ad', /\badventure playground\b/i],
    ['rb', /\broundabouts?\b|\bspinners?\b|\bcarousels?\b/i],
    ['sk', /\bskate ?(?:park|board|boarding|ramps?)\b|\bbmx\b/i],
    ['tp', /\btrampolines?\b/i],
    ['ss', /\bsee-?saws?\b/i],
    ['mb', /\bmonkey bars?\b/i],
    ['spr', /\bspringers?\b|\bspring (?:riders?|rockers?|toys?)\b/i],
    ['gym', /\boutdoor gym\b|\b(?:outdoor )?fitness (?:equipment|area|trail|stations?)\b|\bgym equipment\b/i],
    ['mg', /\bMUGA\b|\bmulti-?use games? areas?\b|\bball courts?\b|\bkickabout\b/i],
    ['bb', /\bbalance (?:beams?|trails?)\b|\bstepping (?:logs|posts)\b/i],
  ],
  access: [
    ['inc', /\binclusive (?:play|equipment|playground|roundabout|swing)\b|\baccessible (?:play|equipment|swing|roundabout)\b|\bwheelchair (?:swing|roundabout|accessible (?:play|roundabout|swing))\b/i],
    ['sen', /\bsensory (?:play|garden|equipment|panels?|area)\b/i],
  ],
  facilities: [
    ['wc', /\b(?:public )?toilets?\b|\bWCs?\b/],
    ['bc', /\bbaby chang/i],
    ['cf', /\bcaf[eé]s?(?![a-z])|\bkiosks?\b|\brefreshments\b/i],
    ['fen', /\b(?:fully )?fenced\b|\benclosed play\b/i],
  ],
  ages: [
    ['under-3', /\btoddlers?\b|\bunder[- ](?:3|three|5|five)s?\b|\binfants?\b|\bunder[- ]fives\b/i],
    ['3-6', /\btoddlers?\b|\bunder[- ](?:5|five|6|six|7|seven|8|eight)s?\b|\byounger children\b|\bjuniors?\b/i],
    ['7-12', /\bjuniors?\b|\bolder children\b|\b(?:8|eight|7|seven)[- ]?(?:to|-)[- ]?(?:12|twelve|13|thirteen|14|fourteen)\b|\bover[- ](?:7|8|seven|eight)s?\b/i],
    ['teens', /\bteen(?:s|agers?)?\b|\byoung people\b|\byouth (?:shelter|area|zone)\b/i],
  ],
};
const NEGATED = /\b(?:no|not|without|closed|nearest|none)\b[^.;]{0,25}$/i;
// Kinds of swing with their own code: these words just before "swings" don't make it plain swings too.
const SWING_KIND = /\b(?:baby|toddler|cradle|infant|basket|nest|team|group|bird'?s?)\s*$/i;

/** Codes for what the council's own words say a park has. Negated mentions ("no toilets on site") are ignored. */
export function describe(t) {
  const out = { equipment: [], ages: [], access: [], facilities: [] };
  for (const [kind, list] of Object.entries(WORDS))
    for (const [code, re] of list) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of t.matchAll(g)) {
        const before = t.slice(Math.max(0, m.index - 40), m.index);
        if (NEGATED.test(before) || (code === 'sw' && SWING_KIND.test(before))) continue;
        out[kind].push(code);
        break;
      }
    }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  if (out.facilities.includes('bc') && !out.facilities.includes('wc')) out.facilities.push('wc');
  if (out.equipment.includes('ad') && out.ages.length === 0) out.ages.push('7-12');
  return out;
}

// "Alexandra Recreation Ground - Parks in Bromley", "Abbey Wood Park | Royal Greenwich": keep the park's part, not the
// directory's or council's name.
const DIRECTORY_PART = /\b(?:directory|council)\b|^(?:parks?|playgrounds?|open spaces?)\b|\bin [A-Z][a-z]+$/i;
const cleanName = (s) => {
  const parts = text(s).replace(/[;\s]+$/, '').split(/\s+[-|–]\s+/).map((x) => x.trim()).filter(Boolean);
  return (parts.length > 1 ? parts.find((x) => !DIRECTORY_PART.test(x)) : parts[0]) ?? parts[0] ?? '';
};

/** One park's page → a record, or null if it has no playground. */
export function parsePark(html, url, feed, inCategory = false) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const named = html.match(/(?:Name|Park name)\s*<\/(?:dt|th)>\s*<(?:dd|td)[^>]*>([\s\S]*?)<\/(?:dd|td)>/i)?.[1];
  let name = cleanName(named ?? (feed.nameFrom === 'title' ? title : h1) ?? title ?? '');
  if (!name || /\bdirectory\b/i.test(name)) {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    name = last.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
  }
  if (!name) return null;
  if (feed.include && !new RegExp(feed.include, 'i').test(name)) return null;
  if (feed.exclude && new RegExp(feed.exclude, 'i').test(name)) return null;
  const at = html.search(/<h1[\s>]/i);
  // The park's own text: from its name on, without the directory's name and search box ("Search Parks and playgrounds
  // directory"), which would otherwise make every park look like it has a playground.
  let t = text(at > 0 ? html.slice(at) : html).replace(/[^;]*\bdirectory\b[^;]*;?/gi, ' ');
  const own = t.indexOf(name);
  if (own > 0) t = t.slice(own);
  // The council's contact details ("Contact us … Parks Service, The Stable Yard … W8 6LU") aren't the park's address.
  // Only the last "Contact us", and only past the first third, so a "Contact us" link in the menu doesn't cut the page.
  const contact = [...t.matchAll(/;\s*Contact (?:us|the (?:parks )?team)\b/gi)].pop();
  if (contact && contact.index > t.length / 3) t = t.slice(0, contact.index);
  t = t.slice(0, 20000);
  const need = feed.require ? new RegExp(feed.require, 'i') : PLAY;
  if (!inCategory && !need.test(feed.require ? html : t)) return null;
  const p = point(html);
  return { name, lat: p?.lat ?? null, lng: p?.lng ?? null, postcode: t.match(POSTCODE)?.[1]?.replace(/\s*(\d[A-Z]{2})$/, ' $1') ?? null, url, ...describe(t), text: t.slice(0, 4000) };
}

/** Reads every list page (page 1, 2, 3… until no new parks turn up), then each park's page. */
async function crawl(feed, listPages, isRecord, inCategory, normalise = (u) => u, seed = []) {
  const found = new Set(seed.map(normalise));
  for (const list of listPages) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = list(page);
      if (!u) break;
      const html = await get(u);
      const before = found.size;
      for (const l of links(html, u)) if (isRecord(l)) found.add(normalise(l));
      await sleep(400);
      if (found.size === before) break; // past the last page
    }
  }
  const out = [];
  for (const u of found) {
    const html = await get(u);
    if (html) {
      const r = parsePark(html, u, feed, inCategory);
      if (r) out.push(r);
    }
    await sleep(500);
  }
  console.log(`  ${feed.directory}: ${found.size} park pages, ${out.length} with a playground`);
  return out;
}

export async function readJadu(feed) {
  const dir = feed.directory.replace(/\/$/, '');
  const host = new URL(dir).host.replace(/^www\./, '');
  const isRecord = (u) => {
    try {
      const x = new URL(u);
      return x.host.replace(/^www\./, '') === host && /\/directory[-_]record\/\d+\//.test(x.pathname);
    } catch {
      return false;
    }
  };
  // Record links on category pages carry "/category/16" on the end; the record is the same without it.
  const normalise = (u) => u.replace(/\/category\/\d+.*$/, '').replace(/\?.*$/, '');
  const cats = [].concat(feed.category ?? []);
  const lists = cats.length
    ? cats.map((c) => (page) => `${dir}/category/${c}${page ? `?page=${page + 1}` : ''}`)
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L) => (page) => `${dir}/a-to-z/${L}${page ? `?page=${page + 1}` : ''}`);
  return crawl(feed, lists, isRecord, !!feed.allPlay && !feed.require, normalise);
}

export async function readLocalGov(feed) {
  const dir = feed.directory.replace(/\/$/, '');
  const base = new URL(dir);
  const prefix = base.pathname.replace(/\/$/, '');
  const isRecord = (u) => {
    try {
      const x = new URL(u);
      if (x.host.replace(/^www\./, '') !== base.host.replace(/^www\./, '') || x.search) return false;
      // A park's page sits under the directory, or (on some sites, such as Croydon) at /node/<directory>/<park>.
      return (x.pathname.startsWith(prefix + '/') && /^[a-z0-9-]+$/.test(x.pathname.slice(prefix.length + 1))) || /^\/node\/\d+\/[a-z0-9-]+$/.test(x.pathname);
    } catch {
      return false;
    }
  };
  // The first list page without "?page=0" (some sites, such as Haringey, refuse list addresses with it), then ?page=1…
  const list = (page) => (page === 0 ? (feed.query ? `${dir}?${feed.query}` : dir) : `${dir}?${feed.query ? `${feed.query}&` : ''}page=${page}`);
  // Parks the list pages don't reach, from the site map (unless a filter query narrows the list to playgrounds).
  const seed = [];
  if (!feed.query) {
    for (let page = 0; page < 10; page++) {
      const xml = await get(`${base.origin}/sitemap.xml${page ? `?page=${page}` : ''}`);
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      if (!locs.length) break;
      for (const u of locs) if (isRecord(u)) seed.push(u.replace('://www.', base.host.startsWith('www.') ? '://www.' : '://'));
      if (!/<urlset/.test(xml)) break; // a sitemap index, not pages of one: stop here
      await sleep(400);
    }
  }
  return crawl(feed, [list], isRecord, !!feed.allPlay && !feed.require, (u) => u.replace(/\/$/, ''), seed);
}

/**
 * Any other website: { "type": "pages", "index": ["https://…/parks?alpha=A", …], "follow": "/find_a_park/[a-z_]+$" }.
 * Every link on the index pages whose address matches "follow" is a park's page, read like a Jadu or LocalGov one.
 * "pages" lists park pages to read as well (or instead, for a site with no list page).
 */
export async function readPages(feed) {
  const follow = new RegExp(feed.follow);
  const isRecord = (u) => follow.test(u.replace(/[?#].*$/, ''));
  const norm = (u) => u.replace(/[?#].*$/, '').replace(/\/$/, '');
  return crawl(feed, [].concat(feed.index ?? []).map((u) => (page) => (page ? null : u)), isRecord, !!feed.allPlay && !feed.require, norm, [].concat(feed.pages ?? []));
}

// Quarterly re-check of listed playgrounds against their own official sources, without Claude. Replaces the
// quarterly Claude tasks that re-read each playground's source pages.
//
// For each playground in scope it reads its official source pages (not OpenStreetMap or photo sites) and decides:
//   - confirmed: a page loads, names the playground, and says nothing about it being closed or rebuilt near its
//     name. Its "checked" date is set to today. Nothing else in the file changes.
//   - closure: a page mentions closure, refurbishment, rebuilding or removal near the playground's name. Left alone and
//     listed for the owner (the description may need a note, or the playground may have gone).
//   - reopened: the playground's own description says it's closed or being rebuilt, but its page no longer says so
//     near its name. Left alone and listed: it may have reopened, so the description needs updating.
//   - gone: every official source link answers "not found" (404 or 410). Listed.
//   - unconfirmed: pages couldn't be read, blocked robots, or don't name the playground. Counted and listed.
// Equipment, opening hours and fees aren't read: a person updates those from the pages listed.
//
// Scope:
//   --scope membership   every playground with a membership field (National Trust, English Heritage and so on)
//   --scope stale        playgrounds with an official source whose checked date is over a year old (or missing),
//                        oldest first, up to --limit (default 1250), membership ones left out
//   --scope all          both
//
//   node scripts/recheck-sources.mjs --scope stale [--limit 1250] [--dir src/content/playgrounds] [--out reports]
//
// Run by .github/workflows/recheck.yml, which opens a pull request with the new checked dates and posts the rest as
// a check-report issue.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OSM_RE = /openstreetmap\.org\/(node|way|relation)\/(\d+)/;
const PHOTO_RE = /(?:geograph\.org\.uk|commons\.wikimedia\.org)\//;
export const official = (s) => /^https?:/.test(s?.url ?? '') && !OSM_RE.test(s.url) && !PHOTO_RE.test(s.url);

const GENERIC = new Set(
  'play area areas playground playgrounds park parks recreation ground grounds playing field fields the and of off road street close lane avenue drive way green common open space adventure natural childrens children kids junior toddler toddlers equipped new old'.split(' '),
);
export const nameWords = (s) => [...new Set(String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !GENERIC.has(w)))];
export const flat = (html) =>
  ` ${String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

// Words that mean the play area is (or is about to be) out of use. "closed at dusk" and the like don't count.
export const CLOSURE = /\b(?:temporarily closed|(?:is|are|now|been|be|currently|remains?|has|have) closed|closed (?:for|until|due|while|from)|closure|closing (?:for|on|from)|refurbish\w*(?! (?:cafe|caf|cottage|shop|toilets?|rooms?|house|kitchen|restaurant|visitor))|being (?:replaced|refurbished|rebuilt|upgraded|redeveloped)|rebuil(?:d|t|ding)|redevelop\w*|removed|demolish\w*|decommission\w*|out of (?:use|action|order)|under construction|fenced off|cordoned|due to reopen|will reopen|reopen(?:s|ing)? (?:in|on|later|soon)|vandal\w*)\b/;
const WINDOW = 300; // characters either side of the playground's name
// A closure only counts when a play word is close to it, so "the house is closed on Fridays" on a stately home's page
// doesn't flag its play area.
const PLAY = /\b(?:play\w*|adventure|swings?|slides?|equipment)\b/;
const PLAY_GAP = 80;

// Does the page name the playground, and does it mention closure near the name? Pure, for tests.
export function assess(page, name) {
  const need = nameWords(name);
  if (!need.length) return { named: false, closure: false, reason: 'name has no distinctive words' };
  const hits = need.filter((w) => page.includes(` ${w} `));
  // Every distinctive word for short names; two in three for longer ones (our names sometimes add "and Splash Park").
  if (need.length <= 2 ? hits.length < need.length : hits.length * 3 < need.length * 2) return { named: false, closure: false, reason: "page doesn't name it" };
  // Look at the text around each place the first distinctive word appears (a page often lists many playgrounds).
  const key = hits.sort((a, b) => b.length - a.length)[0];
  let closure = false;
  let said = '';
  for (let i = page.indexOf(` ${key} `); i >= 0 && !closure; i = page.indexOf(` ${key} `, i + 1)) {
    const near = page.slice(Math.max(0, i - WINDOW), i + WINDOW);
    for (const m of near.matchAll(new RegExp(CLOSURE.source, 'g'))) {
      if (!PLAY.test(near.slice(Math.max(0, m.index - PLAY_GAP), m.index + m[0].length + PLAY_GAP))) continue;
      closure = true;
      said = near.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim();
      break;
    }
  }
  return closure ? { named: true, closure, said } : { named: true, closure };
}

const UA = { 'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; quarterly check of playground sources)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();
async function readPage(url) {
  if (!cache.has(url))
    cache.set(
      url,
      (async () => {
        try {
          const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) });
          if (!r.ok) return { status: r.status, text: null };
          return { status: r.status, text: flat(await r.text()) };
        } catch {
          return { status: 0, text: null };
        }
      })(),
    );
  return cache.get(url);
}

// Sets "checked" in a playground file's text without touching anything else.
export function setChecked(text, date) {
  if (/"checked":\s*(?:"[^"]*"|null)/.test(text)) return text.replace(/"checked":\s*(?:"[^"]*"|null)/, `"checked": "${date}"`);
  const d = JSON.parse(text);
  d.checked = date;
  return JSON.stringify(d, null, 2) + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
  const DIR = arg('--dir', 'src/content/playgrounds');
  const OUT = arg('--out', 'reports');
  const SCOPE = arg('--scope', 'stale');
  const LIMIT = Number(arg('--limit', 1250));
  const STALE_DAYS = Number(arg('--stale-days', 365));
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  const SITE = 'https://swing-by.co.uk/playgrounds/';

  const parks = [];
  for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    if (d.sources?.some(official)) parks.push({ id: f.replace(/\.json$/, ''), file: join(DIR, f), ...d });
  }
  const membership = SCOPE === 'stale' ? [] : parks.filter((p) => p.membership);
  const stale =
    SCOPE === 'membership'
      ? []
      : parks
          .filter((p) => !p.membership && (!p.checked || p.checked < cutoff))
          .sort((a, b) => String(a.checked ?? '').localeCompare(String(b.checked ?? '')))
          .slice(0, LIMIT);
  const todo = [...membership, ...stale];
  const staleTotal = parks.filter((p) => !p.membership && (!p.checked || p.checked < cutoff)).length;
  console.log(`${todo.length} playgrounds to re-check (${membership.length} membership, ${stale.length} of ${staleTotal} not checked for a year)`);

  const res = { confirmed: [], closure: [], reopened: [], gone: [], unconfirmed: [] };
  const hostOf = (u) => new URL(u).hostname;
  const missing = []; // decided at the end: a site that answers "not found" to every page is probably blocking robots
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < todo.length) {
        const p = todo[next++];
        const urls = p.sources.filter(official).map((s) => s.url);
        const pages = [];
        for (const u of urls) {
          pages.push({ url: u, ...(await readPage(u)) });
          await sleep(300);
        }
        const looks = pages.filter((x) => x.text).map((x) => ({ url: x.url, ...assess(x.text, p.name) }));
        const named = looks.filter((x) => x.named);
        const saysClosed = /\b(?:closed|closure|refurbish|rebuil|replac|reopen|fenced off|vandal)/i.test(`${p.description ?? ''}`);
        const entry = { id: p.id, name: p.name, area: p.area, membership: p.membership ?? null, checked: p.checked ?? null, urls };
        if (named.some((x) => x.closure)) res.closure.push({ ...entry, url: named.find((x) => x.closure).url, said: named.find((x) => x.closure).said });
        else if (named.length && saysClosed) res.reopened.push({ ...entry, url: named[0].url });
        else if (named.length) {
          res.confirmed.push(entry);
          await writeFile(p.file, setChecked(await readFile(p.file, 'utf8'), today));
        } else if (pages.length && pages.every((x) => x.status === 404 || x.status === 410)) missing.push(entry);
        else res.unconfirmed.push({ ...entry, why: looks.length ? looks[0].reason : `pages couldn't be read (${pages.map((x) => x.status || 'no answer').join(', ')})` });
        if (++done % 50 === 0) console.log(`  ${done} of ${todo.length}`);
      }
    }),
  );

  const okHosts = new Set();
  for (const [u, pr] of cache) if ((await pr).text) okHosts.add(hostOf(u));
  for (const e of missing) {
    if (e.urls.every((u) => okHosts.has(hostOf(u)))) res.gone.push(e);
    else res.unconfirmed.push({ ...e, why: "the site answered \"not found\" to every page we asked for (it may be blocking robots)" });
  }

  const MAX = 60;
  const link = (x) => `[${x.name}](${SITE}${x.id}/)${x.area ? `, ${x.area}` : ''}`;
  const more = (n) => (n > MAX ? [`- …and ${n - MAX} more (see recheck.json in the run's artifacts)`] : []);
  const L = [`# Playground re-check, ${today}`, ''];
  L.push(
    `Re-read the official source pages of ${todo.length} playgrounds (${membership.length} membership, ${stale.length} not checked for over a year, oldest first${SCOPE === 'membership' ? '' : `; ${Math.max(0, staleTotal - stale.length)} more wait for the next run`}).`,
    '',
    `- **Confirmed:** ${res.confirmed.length}. Their page still names them and says nothing about closure, so their checked date is now ${today} (in the pull request).`,
    `- **Mention closure or rebuilding:** ${res.closure.length}`,
    `- **May have reopened:** ${res.reopened.length}`,
    `- **All source links gone:** ${res.gone.length}`,
    `- **Couldn't confirm:** ${res.unconfirmed.length} (page not readable, blocks robots, or doesn't name the playground)`,
    '',
    'Nothing else was changed. Check each one below against its page before editing; never delete a playground without an official source saying it has gone.',
    '',
  );
  L.push('## Pages that mention closure, refurbishment or rebuilding near the playground', '');
  L.push(...(res.closure.length ? res.closure.slice(0, MAX).map((x) => `- ${link(x)}: ${x.url} (\"…${x.said}…\")`) : ['None.']), ...more(res.closure.length), '');
  L.push('## Described as closed or being rebuilt, but the page no longer says so', '', 'They may have reopened: update the description (and equipment) from the page.', '');
  L.push(...(res.reopened.length ? res.reopened.slice(0, MAX).map((x) => `- ${link(x)}: ${x.url}`) : ['None.']), ...more(res.reopened.length), '');
  L.push('## Every official source link now "not found"', '', 'The listing may have moved or the playground gone: look for a new page.', '');
  L.push(...(res.gone.length ? res.gone.slice(0, MAX).map((x) => `- ${link(x)}: ${x.urls.join(', ')}`) : ['None.']), ...more(res.gone.length), '');
  L.push("## Couldn't confirm", '');
  L.push(...(res.unconfirmed.length ? res.unconfirmed.slice(0, MAX).map((x) => `- ${link(x)}: ${x.why}`) : ['None.']), ...more(res.unconfirmed.length), '');
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'recheck.md'), L.join('\n'));
  await writeFile(join(OUT, 'recheck.json'), JSON.stringify(res, null, 1));
  console.log(L.slice(0, 10).join('\n'));
}

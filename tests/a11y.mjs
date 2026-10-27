// Accessibility and smoke tests: run with `npm test` after `npm run build`.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const PORT = 4329;
const BASE = `http://localhost:${PORT}`;
const PAGES = ['/', '/playgrounds/', '/playgrounds/verulamium/', '/playgrounds/stanborough/', '/road-trips/', '/memberships/', '/my-parks/', '/about/', '/search/', '/search/?q=moneyhole', '/404/', '/playgrounds/in/', '/playgrounds/in/herts/', '/playgrounds/in/herts/st-albans/', '/playgrounds/in/devon/', '/playgrounds/in/essex/chelmsford/'];

// A tiny static server for the built site in dist/.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.yml': 'text/yaml' };
const server = createServer(async (req, res) => {
  let file = join('dist', normalize(decodeURIComponent(new URL(req.url, BASE).pathname)));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(await readFile('dist/404.html'));
  }
});
await new Promise((ok) => server.listen(PORT, ok));

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗', msg);
};

// MapLibre loads its worker from a separate file; without it the map stays blank.
if (!(await readdir('dist/_astro')).some((f) => f.startsWith('maplibre-gl-worker'))) fail('map worker file missing from the build');

// Search engine basics: sitemap, robots.txt, the share image, and the tags and structured data on every page that has them.
{
  const read = (path) => readFile(join('dist', path), 'utf8').catch(() => null);
  const robots = await read('robots.txt');
  if (!robots?.includes('Sitemap: https://swing-by.co.uk/sitemap-index.xml')) fail('robots.txt should point to the sitemap');
  const sitemap = await read('sitemap-0.xml');
  if (!sitemap) fail('sitemap-0.xml is missing from the build');
  else {
    for (const hidden of ['/moderate/', '/my-parks/', '/search/', '/admin/']) if (sitemap.includes(`https://swing-by.co.uk${hidden}<`)) fail(`${hidden} should not be in the sitemap`);
    for (const wanted of ['/', '/playgrounds/verulamium/', '/playgrounds/in/', '/playgrounds/in/herts/']) if (!sitemap.includes(`https://swing-by.co.uk${wanted}<`)) fail(`${wanted} should be in the sitemap`);
  }
  if (!(await stat('dist/og-default.png').catch(() => null))) fail('the share image (og-default.png) is missing');
  for (const path of ['/moderate/', '/my-parks/', '/search/']) if (!(await read(`${path}index.html`))?.includes('name="robots" content="noindex"')) fail(`${path} should have a noindex tag`);
  if ((await read('index.html'))?.includes('noindex')) fail('the home page must not be noindex');

  const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) => [JSON.parse(m[1])].flat());
  const checkHead = (path, html) => {
    if (!html.includes(`<link rel="canonical" href="https://swing-by.co.uk${path}">`)) fail(`${path}: canonical link missing or wrong`);
    for (const t of ['og:title', 'og:description', 'og:url', 'og:image']) if (!html.includes(`property="${t}"`)) fail(`${path}: ${t} missing`);
  };

  // Every playground page: canonical link, share tags, and a Playground with a position.
  const dirs = (await readdir('dist/playgrounds', { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'in').map((d) => d.name);
  let badLd = 0;
  for (const id of dirs) {
    const path = `/playgrounds/${id}/`;
    const html = await read(`playgrounds/${id}/index.html`);
    if (!html) { fail(`${path}: page missing`); continue; }
    checkHead(path, html);
    try {
      const g = jsonLd(html).find((x) => x['@type'] === 'Playground');
      if (!g?.name || typeof g.geo?.latitude !== 'number' || typeof g.geo?.longitude !== 'number' || typeof g.isAccessibleForFree !== 'boolean') throw new Error('incomplete');
    } catch { if (++badLd <= 5) fail(`${path}: structured data is missing or incomplete`); }
  }
  if (badLd > 5) fail(`...and ${badLd - 5} more playground pages with bad structured data`);

  // Every place page: tags, a heading, valid structured data, and every playground it lists is a real page.
  const placeFiles = [];
  const walk = async (dir) => {
    for (const e of await readdir(join('dist', dir), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}/${e.name}`);
      else if (e.name === 'index.html') placeFiles.push(dir);
    }
  };
  await walk('playgrounds/in');
  if (placeFiles.length < 50) fail(`expected plenty of place pages, found ${placeFiles.length}`);
  const built = new Set(dirs);
  let badLinks = 0;
  for (const dir of placeFiles) {
    const path = `/${dir}/`;
    const html = await read(`${dir}/index.html`);
    checkHead(path, html);
    if (!/<h1[ >]/.test(html)) fail(`${path}: no heading`);
    try { if (!jsonLd(html).some((x) => x['@type'] === 'BreadcrumbList')) throw new Error('none'); } catch { fail(`${path}: breadcrumb structured data missing`); }
    for (const [, id] of html.matchAll(/href="\/playgrounds\/([^/"#]+)\/"/g)) if (id !== 'in' && !built.has(id) && ++badLinks <= 5) fail(`${path}: links to a playground page that doesn't exist (${id})`);
    for (const [, target] of html.matchAll(/href="(\/playgrounds\/in\/[^"#]*)"/g)) if (!placeFiles.includes(target.slice(1, -1)) && ++badLinks <= 5) fail(`${path}: links to a place page that doesn't exist (${target})`);
  }
}

try {
  for (const width of [1280, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const path of PAGES) {
      await page.goto(BASE + path);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      for (const v of res.violations) fail(`${path} @${width}px: ${v.id} (${v.nodes.length}) ${v.help}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) fail(`${path} @${width}px scrolls sideways`);
    }
    if (errors.length) fail(`page errors @${width}px: ${errors.join(' | ')}`);
    await ctx.close();
  }

  {
    // Every playground page has a Toilets section; ones with toilets say whether there's baby change.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + '/playgrounds/howard-park-play-area-letchworth-garden-/');
    if ((await page.locator('#loos + [data-baby-change]').getAttribute('data-baby-change')) !== 'yes') fail('Howard Park should show baby change: yes');
    await page.goto(BASE + '/playgrounds/gosse-close-play-area-hoddesdon/');
    if ((await page.locator('#loos + [data-baby-change]').getAttribute('data-baby-change')) !== 'nearby') fail('a playground without toilets should show the nearest-toilets block');
    await ctx.close();
  }

  {
    // Google Analytics must not load until the visitor accepts in the consent bar.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(BASE + '/');
    const gaTag = () => page.locator('script[src*="googletagmanager.com/gtag/js"]').count();
    if (!(await page.locator('#cookie-bar').isVisible())) fail('cookie consent bar is not shown on a first visit');
    if (await gaTag()) fail('Google Analytics loaded before consent');
    await page.getByRole('button', { name: 'No thanks' }).click();
    if (await gaTag()) fail('Google Analytics loaded after "No thanks"');
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await page.getByRole('button', { name: 'Accept analytics' }).click();
    if (!(await gaTag())) fail('Google Analytics did not load after "Accept analytics"');
    await page.goto(BASE + '/about/');
    if (await page.locator('#cookie-bar').isVisible()) fail('cookie consent bar shown again after a choice was made');
    await page.goto(BASE + '/moderate/');
    if (await page.locator('#cookie-bar').count()) fail('moderation page should not include analytics');
    await ctx.close();
  }

  {
    // Searches go to Analytics as events, but only after consent, and a postcode loses its last two characters first.
    const open = async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      await page.route('https://api.postcodes.io/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { postcode: 'AL1 3AF', latitude: 51.7527, longitude: -0.3394 } }) }),
      );
      return { ctx, page };
    };
    const events = (page) => page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] === 'event'));
    const postcodeSearch = async (page) => {
      await page.fill('#where', 'AL1 3AF');
      await page.getByRole('button', { name: "Let's go!" }).click();
      await page.waitForFunction(() => document.querySelector('#where-hint')?.textContent?.startsWith('Showing playgrounds near'));
    };

    {
      const { ctx, page } = await open();
      await page.goto(BASE + '/');
      await page.getByRole('button', { name: 'No thanks' }).click();
      await postcodeSearch(page);
      if ((await events(page)).length) fail('a postcode search sent an Analytics event after "No thanks"');
      await ctx.close();
    }

    {
      const { ctx, page } = await open();
      await page.goto(BASE + '/');
      await page.getByRole('button', { name: 'Accept analytics' }).click();
      await postcodeSearch(page);
      const sent = await events(page);
      const pc = sent.find((e) => e[1] === 'postcode_search');
      if (!pc || pc[2]?.postcode !== 'AL1 3') fail(`postcode search should send the postcode as AL1 3 (last two characters dropped), got ${JSON.stringify(sent)}`);
      if (JSON.stringify(sent).match(/3af/i)) fail('a full postcode was sent to Analytics');

      await page.fill('#where', 'St Albans');
      await page.getByRole('button', { name: "Let's go!" }).click();
      await page.waitForFunction(() => document.querySelector('#where-hint')?.textContent === 'Showing playgrounds near St Albans.');
      const town = (await events(page)).find((e) => e[1] === 'town_search');
      if (town?.[2]?.town !== 'St Albans') fail(`a town search should send town St Albans, got ${JSON.stringify(await events(page))}`);

      await page.goto(BASE + '/search/');
      await page.waitForFunction(() => document.getElementById('search-status')?.textContent !== 'Loading…');
      await page.fill('#q', 'moneyhole');
      await page.keyboard.press('Enter');
      await page.fill('#q', 'visit AL1 3AF');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /result|Nothing found/.test(document.getElementById('search-status')?.textContent ?? ''));
      const searches = (await events(page)).filter((e) => e[1] === 'advanced_search');
      if (searches[0]?.[2]?.search_term !== 'moneyhole' || typeof searches[0]?.[2]?.results_count !== 'number') fail(`advanced search should send search_term moneyhole and results_count, got ${JSON.stringify(searches)}`);
      if (searches[1]?.[2]?.search_term !== 'visit al1 3') fail(`a postcode typed in advanced search should lose its last two characters, got ${JSON.stringify(searches)}`);
      if (JSON.stringify(await events(page)).match(/3af/i)) fail('a full postcode was sent to Analytics');
      await ctx.close();
    }
  }

  {
    // Hearts on the home page's cards work straight away, and still work (once, not twice) after "Show more playgrounds".
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    const heart = page.locator('#cards [data-fav]').first();
    await heart.click();
    if ((await heart.getAttribute('aria-pressed')) !== 'true') fail('the heart on a home page card did nothing before "Show more playgrounds" was used');
    await heart.click();
    await page.getByRole('button', { name: 'Show more playgrounds' }).click();
    await page.getByRole('button', { name: 'Show more playgrounds' }).click();
    await heart.click();
    if ((await heart.getAttribute('aria-pressed')) !== 'true') fail('the heart on a home page card did not turn on after "Show more playgrounds" was used twice');
    await ctx.close();
  }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.keyboard.press('Tab');
  if ((await page.evaluate(() => document.activeElement?.textContent)) !== 'Skip to content') fail('first Tab does not reach the skip link');
  const before = await page.locator('#cards .card').count();
  await page.getByRole('button', { name: 'Splash play' }).click();
  const splash = await page.locator('#cards .card').count();
  if (!(splash > 0 && splash <= before)) fail(`splash filter gave ${splash} cards`);
  if ((await page.getByRole('button', { name: 'Splash play' }).getAttribute('aria-pressed')) !== 'true') fail('toggle does not set aria-pressed');
  if (!(await page.locator('#count').textContent())?.includes('playgrounds found')) fail('result count not announced');

  // The counter must match the number of playground files.
  const files = (await readdir('src/content/playgrounds')).filter((f) => f.endsWith('.json')).length;
  const counter = await page.locator('.counter strong').textContent();
  if (Number(counter) !== files) fail(`counter says ${counter} but there are ${files} playgrounds`);

  // "Let's go!" sits on the same row as "Near me".
  const near = await page.locator('#locate').boundingBox();
  const go = await page.getByRole('button', { name: "Let's go!" }).boundingBox();
  if (Math.abs(near.y - go.y) > 2) fail('"Let\'s go!" is not next to "Near me"');

  // Vote: with no /api/vote (this static server), voting says so instead of failing silently.
  await page.getByRole('radio', { name: 'Essex' }).check();
  await page.getByRole('button', { name: 'Cast my vote' }).click();
  await page.locator('#vote-msg.err').waitFor({ timeout: 5000 }).catch(() => fail('vote failure not reported'));

  // Parents' equipment form: open on Unverified playgrounds, folded away on checked ones with equipment listed,
  // offers the site's equipment list, and says so when it can't send (no /api/equipment on this static server).
  await page.goto(BASE + '/playgrounds/playground-off-tennyson-drive-redhouse-park-newport-pagnell/');
  if (!(await page.locator('#peq-details').getAttribute('open') !== null)) fail('equipment form should be open on an Unverified playground');
  if ((await page.locator('#peq-form input[name=item]').count()) < 15) fail('equipment form should offer the equipment list');
  if (await page.locator('#peq-form input[value=bc]').count()) fail('baby change must not be offered to parents');
  await page.getByRole('checkbox', { name: /Swings/ }).first().check();
  await page.getByRole('button', { name: 'Send what I saw' }).click();
  await page.getByText(/couldn't send|not set up/i).waitFor({ timeout: 5000 }).catch(() => fail('equipment send failure not reported'));
  await page.goto(BASE + '/playgrounds/verulamium/');
  if ((await page.locator('#peq-details').getAttribute('open')) !== null) fail('equipment form should be folded away on a checked playground');

  // Size filter lives under "More filters" and only shows graded playgrounds of that size.
  await page.goto(BASE + '/');
  await page.getByText('More filters').click();
  await page.getByRole('checkbox', { name: /^Large/ }).check();
  const sized = await page.locator('#cards .card').count();
  const large = await page.locator('#cards .card .size-large').count();
  if (!(sized > 0 && sized === large)) fail(`size filter: ${sized} cards, ${large} marked large`);

  // Free entry only: hides every playground with a fee, and only those.
  await page.goto(BASE + '/');
  const paid = JSON.parse(await page.locator('#parks-data').textContent()).parks.filter((x) => x.pay).length;
  const countOf = async () => Number((await page.locator('#count').textContent()).match(/\d+/)?.[0]);
  await page.getByRole('checkbox', { name: 'Free entry only' }).check();
  const freeCount = await countOf();
  await page.getByRole('checkbox', { name: 'Free entry only' }).uncheck();
  const allCount = await countOf();
  if (!(paid > 0 && allCount - freeCount === paid)) fail(`free entry filter: ${allCount} → ${freeCount}, expected ${paid} fewer`);
  // A paid playground shows the £ badge on its page.
  await page.goto(BASE + '/playgrounds/calke/');
  if (!(await page.getByText('Paid entry.').count())) fail('paid entry note missing on a playground with a fee');

  // Favourites: the heart on a playground page saves it, and My parks lists it.
  await page.goto(BASE + '/playgrounds/verulamium/');
  await page.locator('.fav-big').click();
  if ((await page.locator('.fav-big').getAttribute('aria-pressed')) !== 'true') fail('favourite button did not turn on');
  await page.goto(BASE + '/my-parks/');
  if (!(await page.locator('#fav-cards .card').count())) fail('favourite not listed on My parks');
  await page.locator('#fav-cards .fav-btn').first().click();
  if (await page.locator('#fav-cards .card').count()) fail('removing a favourite on My parks did not take it off the list');

  // Ticking "We've been here" asks for a photo, and "Add a photo" takes you to the form.
  await page.goto(BASE + '/playgrounds/verulamium/');
  await page.getByLabel("We've been here").check();
  await page.locator('#photo-nudge').waitFor({ state: 'visible', timeout: 3000 }).catch(() => fail('photo nudge did not appear after ticking'));
  await page.getByRole('button', { name: 'Add a photo' }).click();
  if (!(await page.evaluate(() => document.activeElement?.id === 'photo-file'))) fail('Add a photo did not move to the photo form');

  // Road trips: a town finds its nearest junction and the playgrounds near it.
  await page.goto(BASE + '/road-trips/');
  await page.fill('#jf-where', 'St Albans');
  await page.getByRole('button', { name: 'Find junctions' }).click();
  await page.locator('#jf-best').waitFor({ timeout: 5000 }).catch(() => fail('road trips: no nearest junction shown'));
  if (!(await page.locator('#jf-results .jf-best li').count())) fail('road trips: no playgrounds listed for the nearest junction');

  // Site search finds a park by name (including a missing space or a slip) and by town.
  for (const [q, want] of [['moneyhole', 'Moneyhole Lane Playing Fields Playground'], ['money hole lane', 'Moneyhole Lane Playing Fields Playground'], ['digswel', 'Digswell Playing Fields Play Area']]) {
    await page.goto(BASE + '/search/?q=' + encodeURIComponent(q));
    await page.locator('#search-results .hit').first().waitFor();
    const first = await page.locator('#search-results .hit > a').first().textContent();
    if (first !== want) fail(`search "${q}" put "${first}" first`);
  }
  // The header has no search box: advanced search is linked from the footer, and Find stays in the header.
  await page.goto(BASE + '/');
  if (await page.locator('.site-header [role="search"], .site-header input[type="search"]').count()) fail('the header should not have a search box');
  if (!(await page.locator('.site-header .nav').getByRole('link', { name: 'Find', exact: true }).count())) fail('the Find link is missing from the header');
  await page.locator('.site-footer').getByRole('link', { name: 'Advanced search' }).click();
  await page.waitForURL(/\/search\/$/);
  await page.getByRole('searchbox', { name: 'Search Swing By' }).fill('Welwyn Garden City');
  await page.keyboard.press('Enter');
  await page.locator('#search-results .hit').first().waitFor();
  if ((await page.locator('#search-results .hit').count()) < 10) fail('advanced search for Welwyn Garden City found too few');

  // The dusk line is worked out in the browser for the playground's position, in the form "Dusk is around 16:45 today."
  await page.goto(BASE + '/playgrounds/verulamium/');
  await page.waitForFunction(() => /^Dusk is around \d\d:\d\d today\.$/.test(document.querySelector('[data-dusk]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => fail('the dusk line on a playground page is missing or in the wrong form'));

  await page.goto(BASE + '/playgrounds/verulamium/');
  await page.getByLabel('4 out of 5').focus();
  await page.keyboard.press('Space');
  if (!(await page.locator('#been').isChecked())) fail('rating did not tick "been here"');
  await page.goto(BASE + '/my-parks/');
  if (!(await page.getByRole('link', { name: 'Verulamium Park Playground' }).count())) fail('my parks does not list the rated park');
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('All accessibility and smoke checks passed');

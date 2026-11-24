// Accessibility and smoke tests in a browser: run with `npm test` after `npm run build`. The checks that need no browser
// (sitemap, share tags, structured data, links) are in tests/site.mjs.
//
// Light mode, for pull requests that only change data (new playgrounds, pins, toilets): A11Y_ONLY="/playgrounds/a/,/playgrounds/b/"
// checks just those pages with axe at both widths, and skips the full page set and the smoke tests, since the page
// templates haven't changed. The yearly full scan (tests/a11y-full.mjs) checks every page.
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { serve, WCAG } from './serve.mjs';

const ONLY = (process.env.A11Y_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PAGES = ['/', '/playgrounds/', '/playgrounds/verulamium/', '/playgrounds/stanborough/', '/road-trips/', '/memberships/', '/my-parks/', '/about/', '/search/', '/search/?q=moneyhole', '/404/', '/playgrounds/in/', '/playgrounds/in/herts/', '/playgrounds/in/herts/st-albans/', '/playgrounds/in/devon/', '/playgrounds/in/essex/chelmsford/', '/playgrounds/in/herts/a-z/s/'];

const { server, base: BASE } = await serve(4329);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗', msg);
};


try {
  for (const width of [1280, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const path of ONLY.length ? ONLY : PAGES) {
      await page.goto(BASE + path);
      const res = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      for (const v of res.violations) fail(`${path} @${width}px: ${v.id} (${v.nodes.length}) ${v.help}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) fail(`${path} @${width}px scrolls sideways`);
    }
    if (errors.length) fail(`page errors @${width}px: ${errors.join(' | ')}`);
    await ctx.close();
  }
  if (ONLY.length) {
    console.log(`Light check: ${ONLY.length} page(s) at both widths: ${ONLY.join(', ')}`);
    throw 'light';
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

  // Feedback: with no /api/feedback (this static server), sending says so instead of failing silently.
  await page.getByLabel('Your suggestion').fill('A filter for playgrounds with shade, please');
  await page.getByRole('button', { name: 'Send suggestion' }).click();
  await page.locator('#feedback-msg.err').waitFor({ timeout: 5000 }).catch(() => fail('feedback failure not reported'));

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

  // Equipment filters: the 20 most common are shown, the next ones sit under "More filters", most common first.
  // Checked on a winter date, so Splash play sits where its count puts it whenever the tests run.
  await page.clock.setFixedTime(new Date('2027-01-15T12:00:00'));
  await page.goto(BASE + '/');
  const shownLoves = await page.locator('.loves > .row [data-love]').count();
  const moreLoves = await page.locator('#more-filters [data-love]').count();
  if (shownLoves !== 20) fail(`the finder should show 20 equipment filters, got ${shownLoves}`);
  if (!(moreLoves > 0 && moreLoves <= 20)) fail(`"More filters" should hold up to 20 more equipment filters, got ${moreLoves}`);
  const parksData = JSON.parse(await page.locator('#parks-data').textContent()).parks;
  const keys = await page.locator('[data-love]').evaluateAll((els) => els.map((e) => e.dataset.love));
  const counts = keys.map((k) => parksData.filter((x) => x.f.includes(k)).length);
  const pinned = await page.locator('[data-love][data-pin]').evaluateAll((els) => els.map((e) => e.dataset.love));
  const order = keys.map((k, i) => [k, counts[i]]).filter(([k]) => !pinned.includes(k)).map(([, n]) => n);
  if (order.some((n, i) => i && n > order[i - 1])) fail(`equipment filters should be most common first, got ${keys.map((k, i) => k + ':' + counts[i]).join(' ')}`);
  // Miniature railway is always in the main list, however few playgrounds have it.
  if (!(await page.locator('.loves > .row [data-love="tr"]').count())) fail('Miniature railway should always be in the main filter list');
  await page.getByText('More filters').click();
  const lastKey = keys[keys.length - 1];
  await page.locator(`#more-filters [data-love="${lastKey}"]`).click();
  const withIt = parksData.filter((x) => x.f.includes(lastKey)).length;
  const shownCount = Number((await page.locator('#count').textContent()).match(/\d+/)?.[0]);
  if (!(shownCount > 0 && shownCount <= withIt)) fail(`a filter under "More filters" should narrow the results to ${withIt} or fewer, got ${shownCount}`);

  // From April to September, while splash parks are on, Splash play moves up into the main list (if it isn't there
  // already), with 20 still shown. In winter it goes back to where its count puts it.
  for (const [when, inSeason] of [['2027-04-01T12:00:00', true], ['2027-09-30T12:00:00', true], ['2027-07-15T12:00:00', true], ['2027-01-15T12:00:00', false]]) {
    const p2 = await browser.newPage();
    await p2.clock.setFixedTime(new Date(when));
    await p2.goto(BASE + '/');
    const wpTop = await p2.locator('.loves > .row [data-love="wp"]').count();
    const wpRanked = keys.indexOf('wp') > -1 && keys.indexOf('wp') < 20;
    if (inSeason && !wpTop) fail(`Splash play should be in the main filter list on ${when}`);
    if (!inSeason && !!wpTop !== wpRanked) fail(`Splash play should only be in the main list by count on ${when}`);
    if ((await p2.locator('.loves > .row [data-love]').count()) !== 20) fail(`the main filter list should have 20 on ${when}`);
    if (!(await p2.locator('.loves > .row [data-love="tr"]').count())) fail(`Miniature railway should stay in the main list on ${when}`);
    await p2.close();
  }

  // "Which playgrounds?" holds Hide unverified and Free entry only. Play area size is hidden for now (too few
  // playgrounds are graded) and stays off Advanced search.
  await page.goto(BASE + '/');
  const which = page.getByRole('group', { name: 'Which playgrounds?' });
  for (const name of [/^Hide unverified/, /^Free entry only/])
    if (!(await which.getByRole('checkbox', { name }).count())) fail(`"Which playgrounds?" should hold ${name}`);
  if (await page.locator('input[name=size]').count()) fail('play area size should be hidden on the home page for now');
  if (await page.goto(BASE + '/search/').then(() => page.locator('input[name=size]').count())) fail('play area size should not be on Advanced search');

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
  // A playground that already has a photo asks for a better one, not a first one.
  await page.goto(BASE + '/playgrounds/northaw-playground-northaw/');
  if (!(await page.getByRole('heading', { name: 'Share a better photo' }).count())) fail('playground with a photo should ask for a better photo');
  await page.getByLabel("We've been here").check();
  if (!(await page.getByRole('button', { name: 'Share a better photo' }).count())) fail('photo nudge should ask for a better photo when there is one');

  // Road trips: a town finds its nearest junction and the playgrounds near it.
  await page.goto(BASE + '/road-trips/');
  await page.fill('#jf-where', 'St Albans');
  await page.getByRole('button', { name: 'Find junctions' }).click();
  await page.locator('#jf-best').waitFor({ timeout: 5000 }).catch(() => fail('road trips: no nearest junction shown'));
  if (!(await page.locator('#jf-results .jf-best li').count())) fail('road trips: no playgrounds listed for the nearest junction');

  // Site search finds a park by name (including a missing space or a slip) and by town.
  // Moneyhole Lane Playing Fields has two listings (the main playground and a separate toddler area): either can come first.
  const moneyhole = ['Moneyhole Lane Playing Fields Playground', 'Moneyhole Lane Park'];
  for (const [q, want] of [['moneyhole', moneyhole], ['money hole lane', moneyhole], ['digswel', ['Digswell Playing Fields Play Area']]]) {
    await page.goto(BASE + '/search/?q=' + encodeURIComponent(q));
    await page.locator('#search-results .hit').first().waitFor();
    const first = await page.locator('#search-results .hit > a').first().textContent();
    if (!want.includes(first)) fail(`search "${q}" put "${first}" first`);
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
} catch (e) {
  if (e !== 'light') throw e;
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('All accessibility and smoke checks passed');

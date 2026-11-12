// The yearly full accessibility scan: every built page, at desktop and phone widths, checked with axe (the same WCAG
// rules as tests/a11y.mjs), plus sideways scrolling and script errors. Run by .github/workflows/a11y-full.yml, split
// across several jobs; scripts/a11y-report.mjs combines their results into one report.
//
//   SHARD=0 SHARDS=8 node tests/a11y-full.mjs      after `npm run build`; writes reports/a11y-full-0.json
//   LIMIT=20 node tests/a11y-full.mjs              a quick local try on the first 20 pages
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { packedIds, serve, WCAG } from './serve.mjs';

const SHARD = Number(process.env.SHARD ?? 0);
const SHARDS = Number(process.env.SHARDS ?? 1);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const WIDTHS = [1280, 375];
const SKIP = /^\/(admin|moderate)\//; // the content editor and the photo moderation page sit behind a sign-in

/** Every page in dist/ as a site path, e.g. /playgrounds/verulamium/ (packed playground pages are added below). */
async function pages(dir = '') {
  const out = [];
  for (const e of await readdir(join('dist', dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await pages(`${dir}/${e.name}`)));
    else if (e.name === 'index.html') out.push(`${dir}/`);
  }
  return out;
}

const all = [...(await pages()), ...(await packedIds()).map((id) => `/playgrounds/${id}/`)].filter((p) => !SKIP.test(p)).sort();
const mine = all.filter((_, i) => i % SHARDS === SHARD).slice(0, LIMIT);
console.log(`Shard ${SHARD + 1} of ${SHARDS}: ${mine.length} of ${all.length} pages, at ${WIDTHS.join(' and ')}px`);

const { server, base } = await serve(4330 + SHARD);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const found = []; // { page, width, rule, help, impact, nodes, example }
const problems = []; // { page, width, problem }
const started = Date.now();
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    // Keep outside services (map tiles, analytics) out of the scan: they're not ours to fix, and they slow it down.
    await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    const page = await ctx.newPage();
    let errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [i, path] of mine.entries()) {
      errors = [];
      try {
        await page.goto(base + path, { waitUntil: 'load', timeout: 30000 });
        const res = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        for (const v of res.violations)
          found.push({ page: path, width, rule: v.id, help: v.help, impact: v.impact, nodes: v.nodes.length, example: v.nodes[0]?.target?.join(' ') ?? '' });
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) problems.push({ page: path, width, problem: 'scrolls sideways' });
        for (const e of errors) problems.push({ page: path, width, problem: `script error: ${e.slice(0, 200)}` });
      } catch (e) {
        problems.push({ page: path, width, problem: `couldn't be checked: ${String(e.message ?? e).split('\n')[0].slice(0, 200)}` });
      }
      if ((i + 1) % 250 === 0) console.log(`  ${width}px: ${i + 1} pages, ${Math.round((Date.now() - started) / 60000)} min`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

await mkdir('reports', { recursive: true });
await writeFile(`reports/a11y-full-${SHARD}.json`, JSON.stringify({ shard: SHARD, shards: SHARDS, pages: mine.length, total: all.length, found, problems }) + '\n');
console.log(`Done: ${found.length} axe findings and ${problems.length} other problems in ${Math.round((Date.now() - started) / 60000)} min`);

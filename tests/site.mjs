// Site checks that need no browser: the map worker file, sitemap and robots.txt, share tags and structured data on
// every playground and place page, and links between them. Run after `npm run build` (part of `npm test`, and run on
// every pull request, including data-only ones).
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { packedIds, readPacked } from './serve.mjs';

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
  // Most are packed (worker/packs.js); any left as their own folder are checked too.
  const folders = (await readdir('dist/playgrounds', { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'in').map((d) => d.name);
  const packed = await packedIds();
  const dirs = [...packed, ...folders];
  if (new Set(dirs).size !== dirs.length) fail('some playground pages are both packed and left as folders');
  if (dirs.length < 1000) fail(`expected thousands of playground pages, found ${dirs.length}`);
  const packedSet = new Set(packed);
  let badLd = 0;
  for (const id of dirs) {
    const path = `/playgrounds/${id}/`;
    const html = packedSet.has(id) ? (await readPacked(id))?.toString('utf8') : await read(`playgrounds/${id}/index.html`);
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

if (failures) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('site: ok');

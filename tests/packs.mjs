// Checks packed playground pages (worker/packs.js, scripts/pack-pages.mjs) on a made-up build: packing, reading back,
// and how the Worker answers (pages, redirects, 304s, and falling through for anything not packed). No network needed.
// Run by `npm test`.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKS, packFor, servePacked } from '../worker/packs.js';
import { packedIds, readPacked } from './serve.mjs';

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗ ' + msg);
};

// The hash must never change, or every page would be looked for in the wrong pack.
if (packFor('verulamium') !== packFor('verulamium') || packFor('a') === packFor('b')) fail('packFor should be stable and spread ids');
if (packFor('verulamium') !== 838) fail('packFor changed: pages would be looked for in the wrong pack');

const dist = await mkdtemp(join(tmpdir(), 'packs-'));
try {
  const pages = { 'oak-park': '<html>Oak Park £ ✓</html>', 'elm-rec': '<html>Elm</html>', 'c-old': '<html>Old</html>' };
  for (const [id, html] of Object.entries(pages)) {
    await mkdir(join(dist, 'playgrounds', id), { recursive: true });
    await writeFile(join(dist, 'playgrounds', id, 'index.html'), html);
  }
  await mkdir(join(dist, 'playgrounds', 'in', 'herts'), { recursive: true });
  await writeFile(join(dist, 'playgrounds', 'in', 'herts', 'index.html'), '<html>Herts</html>');
  await mkdir(join(dist, 'playgrounds', 'with-image'), { recursive: true });
  await writeFile(join(dist, 'playgrounds', 'with-image', 'index.html'), '<html>Img</html>');
  await writeFile(join(dist, 'playgrounds', 'with-image', 'photo.jpg'), 'jpg');
  execFileSync('node', ['scripts/pack-pages.mjs', dist], { stdio: 'pipe' });

  const left = await readdir(join(dist, 'playgrounds'));
  if (left.sort().join() !== 'in,with-image') fail(`only "in" and folders with other files should be left, found ${left}`);
  if ((await readdir(join(dist, '_pages'))).length !== PACKS) fail(`expected ${PACKS} pack files`);
  if ((await packedIds(dist)).sort().join() !== 'c-old,elm-rec,oak-park') fail('packedIds should list the three packed pages');
  if ((await readPacked('oak-park', dist))?.toString('utf8') !== pages['oak-park']) fail('a packed page should read back byte for byte');

  // A stand-in for the Worker's ASSETS binding, serving the made-up build.
  const assets = {
    fetch: async (req) => {
      const file = join(dist, new URL(req.url).pathname);
      const ok = await stat(file).catch(() => null);
      return ok?.isFile() ? new Response(await readFile(file)) : new Response('missing', { status: 404 });
    },
  };
  const ask = (path, init) => servePacked(new Request(`https://swing-by.co.uk${path}`, init), assets);

  const page = await ask('/playgrounds/oak-park/');
  if (page?.status !== 200 || (await page.text()) !== pages['oak-park']) fail('a packed page should be served as built');
  if (!page?.headers.get('content-type')?.startsWith('text/html')) fail('a packed page should be served as HTML');
  const etag = page?.headers.get('etag');
  if (!etag) fail('a packed page should have an ETag');
  if ((await ask('/playgrounds/oak-park/', { headers: { 'If-None-Match': etag } }))?.status !== 304) fail('a matching ETag should get a 304');
  const head = await ask('/playgrounds/oak-park/', { method: 'HEAD' });
  if (head?.status !== 200 || (await head.text()) !== '') fail('HEAD should get headers only');
  for (const loose of ['/playgrounds/oak-park', '/playgrounds/oak-park/index.html']) {
    const r = await ask(loose);
    if (r?.status !== 307 || r.headers.get('location') !== '/playgrounds/oak-park/') fail(`${loose} should redirect to /playgrounds/oak-park/`);
  }
  if ((await ask('/playgrounds/oak-park?x=1'))?.headers.get('location') !== '/playgrounds/oak-park/?x=1') fail('redirects should keep the query');
  for (const through of ['/playgrounds/nowhere/', '/playgrounds/in/', '/playgrounds/in/herts/', '/playgrounds/with-image/', '/about/', '/']) {
    if ((await ask(through)) !== null) fail(`${through} should fall through to the static files`);
  }
  if ((await ask('/playgrounds/oak-park/', { method: 'POST' })) !== null) fail('only GET and HEAD should be served from packs');
  // A build without packs (say, astro build on its own) falls through to the static files.
  if ((await servePacked(new Request('https://swing-by.co.uk/playgrounds/oak-park/'), { fetch: async () => new Response('', { status: 404 }) })) !== null) fail('no packs should fall through');
} finally {
  await rm(dist, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('packs: ok');

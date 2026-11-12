// Packs every playground page into a few hundred files after `astro build`, so the site stays well under
// Cloudflare's 20,000 files per deploy on the free plan (see worker/packs.js for the format and how the Worker serves
// them). Runs as part of `npm run build`. Only folders holding nothing but index.html are packed; anything else in a
// playground's folder is left as a normal file.
//
//   node scripts/pack-pages.mjs [dist]
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PACKS, PACK_DIR, cutPage, packFor, packPath } from '../worker/packs.js';

const dist = process.argv[2] ?? 'dist';
const root = join(dist, 'playgrounds');
const packs = Array.from({ length: PACKS }, () => []);
const done = [];
let skipped = 0;

for (const e of await readdir(root, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name === 'in' || !/^[a-z0-9-]+$/.test(e.name)) continue;
  const dir = join(root, e.name);
  const files = await readdir(dir);
  if (files.length !== 1 || files[0] !== 'index.html') { skipped++; continue; }
  packs[packFor(e.name)].push({ id: e.name, body: await readFile(join(dir, 'index.html')) });
  done.push(dir);
}

await rm(join(dist, PACK_DIR), { recursive: true, force: true });
await mkdir(join(dist, PACK_DIR), { recursive: true });
let biggest = 0;
for (let n = 0; n < PACKS; n++) {
  const pages = packs[n].sort((a, b) => a.id.localeCompare(b.id));
  const index = {};
  let at = 0;
  for (const p of pages) {
    index[p.id] = [at, p.body.length, createHash('sha1').update(p.body).digest('hex').slice(0, 16)];
    at += p.body.length;
  }
  const out = Buffer.concat([Buffer.from(JSON.stringify(index) + '\n'), ...pages.map((p) => p.body)]);
  biggest = Math.max(biggest, out.length);
  await writeFile(join(dist, packPath(n)), out);
  // Read every page back the way the Worker will, and check it's byte for byte what Astro built.
  const back = new Uint8Array(await readFile(join(dist, packPath(n))));
  for (const p of pages) {
    const got = cutPage(back, p.id);
    if (!got || !Buffer.from(got.body).equals(p.body)) {
      console.error(`Pack ${n}: /playgrounds/${p.id}/ doesn't read back as Astro built it. Nothing has been deleted.`);
      process.exit(1);
    }
  }
}
for (const dir of done) await rm(dir, { recursive: true });

const mb = (n) => (n / 1e6).toFixed(1);
console.log(`Packed ${done.length} playground pages into ${PACKS} files (largest ${mb(biggest)} MB)${skipped ? `; left ${skipped} folders with other files as they were` : ''}.`);
// Cloudflare refuses files over 25 MiB; warn well before, so PACKS can be raised in good time.
if (biggest > 5e6) console.log(`::warning title=Packed pages::The largest page pack is ${mb(biggest)} MB. Raise PACKS in worker/packs.js.`);
if (biggest > 25 * 1024 * 1024) process.exit(1);

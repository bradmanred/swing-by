// How close the built site is to Cloudflare's limit on static files per deploy.
//
// Cloudflare's free Workers plan allows 20,000 files per deploy. Playground pages are packed into 1,000 files
// (scripts/pack-pages.mjs, worker/packs.js), so the count is mostly place pages, scripts and images. Wrangler's "Read N files" message counts folders as well, so it reads
// about twice the real number; the limit only counts files, which is what this counts (files only, no folders or
// symbolic links, the same as Wrangler's upload manifest).
//
//   node scripts/count-assets.mjs [dist]
//
// ASSET_LIMIT (default 20000) is the plan's limit: set it to 100000 in ci.yml after upgrading to Workers Paid.
// At WARN_AT (95% of the limit, 19,000 on the free plan) it warns and sets near=true for the workflow; at the limit
// it fails, because Cloudflare would refuse the deploy.
import { appendFileSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function countAssets(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) n += countAssets(join(dir, entry.name));
    else if (entry.isFile()) n++;
  }
  return n;
}

export function assetStatus(count, limit = 20000) {
  const warnAt = Math.floor(limit * 0.95);
  return { count, limit, warnAt, left: limit - count, near: count >= warnAt, over: count >= limit };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'dist';
  const limit = Number(process.env.ASSET_LIMIT) || 20000;
  let s;
  try {
    lstatSync(join(dir, '.assetsignore'));
    console.log(`Note: ${dir}/.assetsignore exists; its patterns aren't applied here, so this count is an upper bound.`);
  } catch {}
  s = assetStatus(countAssets(dir), limit);
  const line = `${s.count.toLocaleString('en-GB')} files of Cloudflare's ${s.limit.toLocaleString('en-GB')} per deploy (${s.left.toLocaleString('en-GB')} left)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Cloudflare file count:** ${line}.\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `near=${s.near}\ncount=${s.count}\nleft=${s.left}\n`);
  if (s.over) {
    console.log(`::error title=Too many files for Cloudflare::${line}. Cloudflare would refuse this deploy. See "Cloudflare file count" in docs/fixing-check-reports.md.`);
    process.exit(1);
  }
  if (s.near) console.log(`::warning title=Near Cloudflare's file limit::${line}. See "Cloudflare file count" in docs/fixing-check-reports.md.`);
}

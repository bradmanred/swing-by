// Reads one council's playground list and shows what it finds, without changing anything: for checking a new feed
// entry before adding it to src/data/council-sources.json, or after a council changes its website.
//
//   node scripts/try-feed.mjs "Hounslow"                                    the feed already in council-sources.json
//   node scripts/try-feed.mjs '{"type":"jadu","directory":"https://…"}'     a feed being tried out
//
// Run on GitHub with the "Try a council list" workflow, since council websites often block other places.
import { readFile, writeFile } from 'node:fs/promises';
import { readFeed } from './council-feeds.mjs';

const arg = process.argv[2] ?? '';
let feed, title;
if (arg.trim().startsWith('{')) {
  feed = JSON.parse(arg);
  title = feed.directory ?? feed.url ?? 'feed';
} else {
  const { councils } = JSON.parse(await readFile('src/data/council-sources.json', 'utf8'));
  const c = councils.find((c) => c.district.toLowerCase() === arg.toLowerCase() || c.council.toLowerCase() === arg.toLowerCase());
  if (!c?.feed) throw new Error(`No feed for "${arg}" in council-sources.json`);
  ({ feed } = c);
  title = c.council;
}
const recs = await readFeed(feed);
const by = (k) => recs.filter((r) => r.from === k).length;
const lines = [
  `## ${title}`,
  '',
  `${recs.length} playgrounds found${recs.some((r) => r.from) ? ` (${by('map')} with a map point, ${by('postcode')} placed from their postcode)` : ''}.`,
  '',
  '| Name | Position | Equipment | Ages | Facilities | Page |',
  '| --- | --- | --- | --- | --- | --- |',
  ...recs.map((r) => `| ${r.name} | ${r.lat?.toFixed(5)}, ${r.lng?.toFixed(5)}${r.from === 'postcode' ? ` (${r.postcode})` : ''} | ${(r.equipment ?? []).join(' ')} | ${(r.ages ?? []).join(' ')} | ${[...(r.facilities ?? []), ...(r.access ?? [])].join(' ')} | [link](${r.url}) |`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n', { flag: 'a' });
if (!recs.length) process.exitCode = 1;

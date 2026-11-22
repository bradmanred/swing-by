// Fills in `size` on playgrounds that don't have one, from council grading we already hold (scripts/sizes.mjs):
//   1. a Fields in Trust grade (LAP, LEAP, NEAP) in the playground's own description, and
//   2. the playground's row in a council list (src/data/council-lists/*.csv): its "size" column, or a grade in its
//      text. A row counts only when its name matches and its address is on the same website as one of the
//      playground's sources, so a common name ("Recreation Ground Play Area") never picks up another council's row.
// Never changes a size that's already set. The coverage check runs it after adding playgrounds; run it by hand after
// adding a size column or grades to a council list.
//
//   node scripts/apply-sizes.mjs [--dry-run]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv } from './council-feeds.mjs';
import { gradeOf, sizeValue } from './sizes.mjs';

const DIR = 'src/content/playgrounds';
const LISTS = 'src/data/council-lists';
const DRY = process.argv.includes('--dry-run');

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const key = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Council list rows that give a size, by name.
const fromLists = new Map();
for (const f of (await readdir(LISTS)).filter((f) => f.endsWith('.csv'))) {
  for (const r of parseCsv(await readFile(join(LISTS, f), 'utf8'))) {
    const size = sizeValue(r.size) ?? gradeOf(r.text);
    if (size && r.name) fromLists.set(key(r.name), [...(fromLists.get(key(r.name)) ?? []), { size, host: host(r.url), list: f }]);
  }
}

const changed = [];
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(DIR, f);
  const src = await readFile(path, 'utf8');
  const d = JSON.parse(src);
  if (d.size) continue;
  const hosts = new Set((d.sources ?? []).map((s) => host(s.url)).filter(Boolean));
  const row = (fromLists.get(key(d.name)) ?? []).find((r) => r.host && hosts.has(r.host));
  const size = gradeOf(d.description) ?? row?.size ?? null;
  if (!size) continue;
  changed.push(`${f}: ${size}${row && !gradeOf(d.description) ? ` (from ${row.list})` : ''}`);
  if (DRY) continue;
  await writeFile(path, JSON.stringify({ ...d, size }, null, 2) + '\n'); // at the end, like the files graded by hand
}
console.log(`${DRY ? 'Would set' : 'Set'} ${changed.length} size${changed.length === 1 ? '' : 's'}${changed.length ? ':' : '.'}`);
for (const c of changed) console.log(`  ${c}`);

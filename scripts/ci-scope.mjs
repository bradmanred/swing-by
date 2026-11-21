// Decides how much browser testing a pull request needs, to save Actions minutes (see .github/workflows/ci.yml).
//
//   printf 'added\tsrc/content/playgrounds/x.json\n' | node scripts/ci-scope.mjs
//     reads "status<TAB>path" lines (as the pull request files API gives them) and prints "mode=…" and "pages=…" lines
//
// - full: anything that could change how pages look or work (templates, styles, scripts, labels, settings…), so the
//   whole accessibility and smoke test runs (tests/a11y.mjs).
// - light: only data changed (playground files, toilets, council lists, coverage counts, pins, the worker's redirect
//   list). The page templates are the same, so axe checks just up to 3 of the new or changed playground pages, in
//   case something in the new data (a very long name, say) breaks a page.
// - none: data changed but no playground page did (a council list, say): no browser needed.
// The non-browser checks (tests/site.mjs and the rest) run on every pull request regardless.
// The yearly full scan (tests/a11y-full.mjs) checks every page, to catch anything these miss.
import { pathToFileURL } from 'node:url';

const DATA = [
  /^src\/content\/playgrounds\/[^/]+\.json$/,
  /^src\/data\/(toilets|coverage|council-sources|pins-checked|junctions|not-duplicates)\.json$/,
  /^src\/data\/council-lists\/[^/]+\.csv$/,
  /^worker\/index\.js$/, // only its redirect list changes in data pull requests, and the browser test doesn't use the worker
  /^reports\//,
];
const LIGHT_PAGES = 3;

/** files: [{ status, name }], status as the pull request files API gives it (added, modified, removed, renamed…). */
export function scope(files) {
  if (!files.length || files.some((f) => !DATA.some((re) => re.test(f.name)))) return { mode: 'full', pages: [] };
  const pages = files
    .filter((f) => f.status !== 'removed') // a removed playground has no page to check (its address redirects)
    .map((f) => f.name.match(/^src\/content\/playgrounds\/([^/]+)\.json$/)?.[1])
    .filter(Boolean)
    .sort()
    .slice(0, LIGHT_PAGES)
    .map((id) => `/playgrounds/${id}/`);
  return { mode: pages.length ? 'light' : 'none', pages };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = await new Promise((ok) => {
    let t = '';
    process.stdin.on('data', (d) => (t += d)).on('end', () => ok(t));
  });
  const files = input.split('\n').filter(Boolean).map((l) => {
    const [status, name] = l.split('\t');
    return { status, name };
  });
  const { mode, pages } = scope(files);
  console.log(`mode=${mode}`);
  console.log(`pages=${pages.join(',')}`);
}

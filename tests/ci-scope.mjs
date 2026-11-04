// Which pull requests need the full browser test (scripts/ci-scope.mjs), and the yearly full scan's report
// (scripts/a11y-report.mjs).
import assert from 'node:assert/strict';
import { scope } from '../scripts/ci-scope.mjs';
import { report } from '../scripts/a11y-report.mjs';

const f = (name, status = 'added') => ({ name, status });
assert.equal(scope([]).mode, 'full', 'nothing known: test everything');
assert.equal(scope([f('src/pages/index.astro', 'modified')]).mode, 'full');
assert.equal(scope([f('src/content/playgrounds/a.json'), f('src/data/labels.json', 'modified')]).mode, 'full', 'labels change how pages look');
assert.equal(scope([f('src/content/playgrounds/a.json'), f('src/styles/global.css', 'modified')]).mode, 'full');
assert.deepEqual(scope([f('src/content/playgrounds/c.json'), f('src/content/playgrounds/a.json'), f('src/content/playgrounds/b.json'), f('src/content/playgrounds/d.json'), f('src/data/toilets.json', 'modified'), f('worker/index.js', 'modified')]), { mode: 'light', pages: ['/playgrounds/a/', '/playgrounds/b/', '/playgrounds/c/'] });
assert.deepEqual(scope([f('src/content/playgrounds/old.json', 'removed'), f('src/content/playgrounds/new.json')]), { mode: 'light', pages: ['/playgrounds/new/'] });
assert.deepEqual(scope([f('src/data/council-lists/x.csv'), f('src/data/council-sources.json', 'modified')]), { mode: 'none', pages: [] });
assert.equal(scope([f('scripts/find-gaps.mjs', 'modified')]).mode, 'full', 'scripts can change what pages get');

// The yearly full scan's report groups one fault across many pages into one line.
const part = (found, problems = [], pages = 3) => ({ pages, total: 6, found, problems });
const r = report([
  part([{ page: '/a/', width: 1280, rule: 'color-contrast', help: 'Elements must meet minimum color contrast ratio thresholds', impact: 'serious', nodes: 2, example: '.tag' }, { page: '/b/', width: 375, rule: 'color-contrast', help: 'Elements must meet minimum color contrast ratio thresholds', impact: 'serious', nodes: 1, example: '.tag' }]),
  part([{ page: '/a/', width: 375, rule: 'color-contrast', help: 'Elements must meet minimum color contrast ratio thresholds', impact: 'serious', nodes: 2, example: '.tag' }], [{ page: '/c/', width: 375, problem: 'scrolls sideways' }]),
], '2027-01-20');
assert.equal(r.problems, 2);
assert.equal(r.scanned, 6);
assert.match(r.markdown, /\*\*Elements must meet minimum color contrast ratio thresholds \(`color-contrast`, serious impact\)\*\*: 2 pages/);
assert.match(r.markdown, /`\/a\/` \(1280, 375px\)/);
assert.match(r.markdown, /\*\*scrolls sideways\*\*: 1 page\. `\/c\/` \(375px\)/);
assert.match(report([part([], [], 2), part([], [], 3)]).markdown, /Only 5 of 6 pages were scanned/);
assert.match(report([part([], [], 3), part([], [], 3)]).markdown, /No problems found\./);
console.log('ci-scope: ok');

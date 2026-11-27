// Checks the shared ratings rules (worker/ratings.js) on made-up rows. No network needed. Run by `npm test`.
import assert from 'node:assert/strict';
import { summarise } from '../worker/ratings.js';

const row = (reporter, conn, stars, created_at = '2026-11-27 10:00:00') => ({ reporter, conn, stars, created_at });

// Nobody, or one parent alone, shows no average.
assert.deepEqual(summarise([]), { stars: null, parents: 0 });
assert.deepEqual(summarise([row('a', '1', 5)]), { stars: null, parents: 1 }, 'one parent alone is never shown');
// Two households: the average, to one decimal place.
assert.deepEqual(summarise([row('a', '1', 5), row('b', '2', 4)]), { stars: 4.5, parents: 2 });
assert.deepEqual(summarise([row('a', '1', 5), row('b', '2', 4), row('c', '3', 4)]), { stars: 4.3, parents: 3 });
// Two browsers on one connection are one household, and the newest rating counts.
assert.deepEqual(
  summarise([row('a', '1', 1, '2026-11-01 10:00:00'), row('b', '1', 5, '2026-11-02 10:00:00')]),
  { stars: null, parents: 1 },
  'two browsers on one connection count once',
);
assert.deepEqual(
  summarise([row('a', '1', 1, '2026-11-01 10:00:00'), row('b', '1', 5, '2026-11-02 10:00:00'), row('c', '2', 3)]),
  { stars: 4, parents: 2 },
  'the newest rating from a shared connection is the one kept',
);
console.log('✓ ratings');

// scripts/count-assets.mjs: counts files the way Cloudflare's limit does (no folders, no symbolic links).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetStatus, countAssets } from '../scripts/count-assets.mjs';

const dir = mkdtempSync(join(tmpdir(), 'assets-'));
try {
  writeFileSync(join(dir, 'index.html'), '');
  for (const id of ['a', 'b', 'c']) {
    mkdirSync(join(dir, 'playgrounds', id), { recursive: true });
    writeFileSync(join(dir, 'playgrounds', id, 'index.html'), '');
  }
  symlinkSync(join(dir, 'index.html'), join(dir, 'link.html'));
  assert.equal(countAssets(dir), 4, 'four files: folders and the symbolic link are not counted');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

assert.deepEqual(assetStatus(12516), { count: 12516, limit: 20000, warnAt: 19000, left: 7484, near: false, over: false });
assert.equal(assetStatus(18999).near, false);
assert.equal(assetStatus(19000).near, true);
assert.equal(assetStatus(19999).over, false);
assert.equal(assetStatus(20000).over, true);
assert.equal(assetStatus(19000, 100000).near, false, 'a paid plan raises the limit');
console.log('assets: ok');

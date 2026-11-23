// scripts/school-grounds.mjs: a school-grounds playground (src/data/school-grounds.json) leaves the waiting list as
// soon as any listing with an official source is at its OpenStreetMap id or within 150 m, and not for an
// OpenStreetMap-only listing or a photo credit; and one two parents confirm is public goes back under its old address.
// Run by `npm test`.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearListed, restoreConfirmed } from '../scripts/school-grounds.mjs';

const dir = await mkdtemp(join(tmpdir(), 'swing-by-school-'));
const play = join(dir, 'playgrounds');
await mkdir(play);
const file = join(dir, 'school-grounds.json');
const at = (lat, lng, page = 'old') => ({ page, name: 'Playground off Elm Road', area: 'Somewhere', region: 'devon', lat, lng });
await writeFile(file, JSON.stringify({ about: '', playgrounds: { 'way/1': at(50.3, -3.8), 'way/2': at(51.0, -1.0), 'way/3': at(52.0, -2.0), 'way/4': at(53.0, -1.5, 'other') } }));
const park = (id, lat, lng, urls) => writeFile(join(play, `${id}.json`), JSON.stringify({ name: id, lat, lng, sources: urls.map((url) => ({ label: 'x', url })) }));
await park('council-nearby', 50.3005, -3.8, ['https://www.example.gov.uk/play']); // ~55 m from way/1
await park('council-by-id', 51.01, -1.0, ['https://parish.example.org.uk/play', 'https://www.openstreetmap.org/way/2']); // 1 km away, same id
await park('osm-only', 52.0, -2.0, ['https://www.openstreetmap.org/way/3']);
await park('photo-only', 53.0, -1.5, ['https://www.geograph.org.uk/photo/1']);
try {
  const cleared = await clearListed(play, file);
  assert.deepEqual(cleared.map((c) => c.osm).sort(), ['way/1', 'way/2']);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf8')).playgrounds).sort(), ['way/3', 'way/4']);
  assert.deepEqual(await clearListed(play, file), [], 'nothing more to clear');

  // Parents: way/3 (page "old") is confirmed public, so it's put back from OpenStreetMap and its entry cleared.
  const back = await restoreConfirmed(['old', 'some-other-playground'], play, file);
  assert.deepEqual(back.map((b) => b.osm), ['way/3']);
  const doc = JSON.parse(await readFile(join(play, 'old.json'), 'utf8'));
  assert.equal(doc.checked, null);
  assert.equal(doc.sources[0].url, 'https://www.openstreetmap.org/way/3');
  assert.match(doc.description, /parents have told us it's open to everyone/);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf8')).playgrounds), ['way/4']);
  console.log('school-grounds: ok');
} finally {
  await rm(dir, { recursive: true, force: true });
}

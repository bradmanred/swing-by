// Checks the "not checked for over a year" part of scripts/quarterly-check.mjs on made-up playgrounds, with the
// parts that need the network left out. Photo sites (Geograph, Wikimedia Commons) aren't official sources, so a
// playground sourced only from them isn't listed. Also checks the "names and descriptions" part. Run by `npm test`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'swing-by-quarterly-'));
const play = join(dir, 'playgrounds');
await mkdir(play);
const park = (id, sources, checked = null) => writeFile(join(play, `${id}.json`), JSON.stringify({ name: id, lat: 52, lng: -1, sources: sources.map((url) => ({ label: 'x', url })), checked }));
await park('council-never-checked', ['https://www.example.gov.uk/play/1']);
await park('council-old', ['https://www.example.gov.uk/play/2'], '2020-01-01');
await park('council-recent', ['https://www.example.gov.uk/play/3'], new Date().toISOString().slice(0, 10));
await park('photos-only', ['https://www.geograph.org.uk/photo/1', 'https://commons.wikimedia.org/wiki/File:Play.jpg']);
await park('osm-only', ['https://www.openstreetmap.org/node/1']);
const today = new Date().toISOString().slice(0, 10);
const named = (id, name, extra = {}) => writeFile(join(play, `${id}.json`), JSON.stringify({ name, area: 'Aberlady', lat: 52, lng: -1, sources: [{ label: 'x', url: 'https://www.example.gov.uk/play' }], checked: today, description: "A playground on Example Council's own list of play areas.", ...extra }));
await named('village-street', 'Aberlady, Pleasance');
await named('village-play-area', 'Aberlady Play Area', { equipment: ['sw'] });
await named('proper-name', 'Luffness Court', { description: 'Swings and a slide.' });
try {
  execFileSync('node', ['scripts/quarterly-check.mjs', '--dir', play, '--out', dir, '--skip', 'councils,osm,links'], { stdio: 'pipe' });
  const { stale, names, thin } = JSON.parse(await readFile(join(dir, 'quarterly-check.json'), 'utf8'));
  assert.deepEqual(stale.map((p) => p.id).sort(), ['council-never-checked', 'council-old']);
  assert.deepEqual(names.map((p) => p.id), ['village-street']);
  assert.deepEqual(thin.map((p) => p.id), ['village-street']);
  console.log('quarterly: ok');
} finally {
  await rm(dir, { recursive: true, force: true });
}

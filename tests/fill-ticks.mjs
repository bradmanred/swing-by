// Checks scripts/fill-ticks.mjs, which ticks equipment a playground's description mentions: whole words only,
// sentences saying something is missing or gone don't count, road directions don't make a roundabout, the stock
// OpenStreetMap text gives nothing, and toilets and other facilities are never ticked. Run by `npm test`.
import assert from 'node:assert/strict';
import { ticksFrom } from '../scripts/fill-ticks.mjs';

const t = (s) => [...ticksFrom(s).equipment, ...ticksFrom(s).access].sort();
assert.deepEqual(t('Play area with swings, roundabouts, a slide, rockers and a climbing frame.'), ['cl', 'rb', 'sl', 'spr', 'sw']);
assert.deepEqual(t('Toddler multi-play, cradle swings, a basket swing and a zip-wire.'), ['bk', 'bs', 'cl', 'sw', 'zw']);
assert.deepEqual(t('A MUGA, outdoor gym, table tennis table and BMX track.'), ['bt', 'gym', 'mg', 'tt']);
assert.deepEqual(t('Inclusive play area with a wheelchair swing and sensory panels.'), ['inc', 'sen', 'sw']);
assert.deepEqual(t('Swings and a slide. The zip wire has been removed. There is no sandpit.'), ['sl', 'sw'], 'missing or removed things are skipped');
assert.deepEqual(t('Turn left at the roundabout on the A38. Play area with a see-saw.'), ['ss'], 'road roundabouts are not play equipment');
assert.deepEqual(t('A playground on OpenStreetMap near Portsbridge Roundabout, Hilsea. No council list we\'ve checked includes it yet.'), []);
assert.deepEqual(t('Next to Spinners Way, with toilets, baby change, a café and free parking.'), [], 'facilities are never ticked, and street names are not spinners');
assert.deepEqual(t('Swing by on your way to the beach: it has slides.'), ['sl'], '"swing by" is not a swing');
assert.deepEqual(t(''), []);
console.log('fill ticks: ok');

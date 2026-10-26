// Checks the sunset sums behind "Dusk is around 16:45 today" (src/lib/sun.ts). No browser or network needed.
// The reference times are sunsets (UTC) from the independent Python "astral" library, for six places across the UK on
// dates that include the longest and shortest days and both weekends when the clocks change.
import { duskText, sunset } from '../src/lib/sun.ts';

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('✗ ' + msg);
};

const REFERENCE = [
// place, latitude, longitude, date, sunset in UTC
  ['London', 51.5074, -0.1278, '2026-01-15', '2026-01-15T16:20:28Z'],
  ['London', 51.5074, -0.1278, '2026-03-28', '2026-03-28T18:26:43Z'],
  ['London', 51.5074, -0.1278, '2026-03-29', '2026-03-29T18:28:24Z'],
  ['London', 51.5074, -0.1278, '2026-06-21', '2026-06-21T20:21:12Z'],
  ['London', 51.5074, -0.1278, '2026-10-24', '2026-10-24T16:48:24Z'],
  ['London', 51.5074, -0.1278, '2026-10-25', '2026-10-25T16:46:25Z'],
  ['London', 51.5074, -0.1278, '2026-12-21', '2026-12-21T15:53:03Z'],
  ['Edinburgh', 55.9533, -3.1883, '2026-06-21', '2026-06-21T21:02:25Z'],
  ['Edinburgh', 55.9533, -3.1883, '2026-12-21', '2026-12-21T15:39:09Z'],
  ['Penzance', 50.1186, -5.5371, '2026-10-26', '2026-10-26T17:09:07Z'],
  ['Belfast', 54.5973, -5.9301, '2026-09-22', '2026-09-22T18:22:20Z'],
  ['Lerwick', 60.155, -1.145, '2026-06-21', '2026-06-21T21:33:38Z'],
  ['Lerwick', 60.155, -1.145, '2026-12-21', '2026-12-21T14:56:42Z'],
  ['Lowestoft', 52.475, 1.751, '2026-03-30', '2026-03-30T18:23:23Z'],
];
for (const [place, lat, lng, date, utc] of REFERENCE) {
  const [y, m, d] = date.split('-').map(Number);
  const got = sunset(lat, lng, y, m, d);
  const off = got ? Math.abs(got.getTime() - Date.parse(utc)) / 60000 : Infinity;
  if (!(off <= 2)) fail(`sunset at ${place} on ${date} is ${off.toFixed(1)} minutes from the reference (${utc})`);
}

// What visitors see, in UK time, for a spot in London. "now" is midday UTC on the day.
const London = [51.5074, -0.1278];
const shown = (iso) => duskText(...London, new Date(iso + 'T12:00:00Z'));
const minutes = (text) => {
  const m = text.match(/^Dusk is around (\d\d):(\d\d) today\.$/);
  if (!m) fail(`dusk text isn't in the expected form: "${text}"`);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const before = minutes(shown('2026-10-24')); // Saturday, still summer time
const after = minutes(shown('2026-10-25')); // Sunday, clocks have gone back
const drop = before - after;
if (!(drop > 55 && drop < 75)) fail(`when the clocks go back the time should drop by about an hour (24 to 25 Oct 2026), but went from ${before} to ${after} minutes`);
const spring = minutes(shown('2026-03-29')) - minutes(shown('2026-03-28')); // clocks go forward, sunset moves later by about 1h
if (!(spring > 55 && spring < 80)) fail(`when the clocks go forward the time should jump by about an hour (28 to 29 Mar 2026), but moved ${spring} minutes`);

// The same answer wherever the visitor is: it's always UK time.
const keepTz = process.env.TZ;
for (const tz of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Tokyo']) {
  process.env.TZ = tz;
  if (shown('2026-10-26') !== 'Dusk is around 16:45 today.') fail(`for a visitor in ${tz} the time was "${shown('2026-10-26')}", not UK time`);
}
process.env.TZ = keepTz;

// Only on days with no sunset would it say nothing: not a thing in the UK, but it mustn't print "NaN".
if (duskText(89, 0, new Date('2026-12-21T12:00:00Z')) !== '') fail('the dusk text should be empty when the sun doesn\'t set');

if (failures) {
  console.error(`${failures} problem(s) found`);
  process.exit(1);
}
console.log('Dusk times check passed');

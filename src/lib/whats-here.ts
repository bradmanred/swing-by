// The "What's here" copy on playground pages.
//
// Most playgrounds come from a council list or OpenStreetMap with only a stock one-line description
// ("A playground on X Council's own list of play areas."). For those, and for any page short of
// practical detail, this builds a few friendly sentences from facts the page already has: who runs
// it, the nearest other playground, the nearest toilets, and a nudge to tell us what's there.
// It never invents equipment. Hand-written descriptions are always kept as they are.
//
// Each sentence has a few wordings, picked by the playground's id, so a page reads the same on every
// build but thousands of pages don't all say exactly the same thing.

import { type Park } from './parks';

type Loos = { onSite: boolean; known: boolean; nearest: { m: number } | null };

const COUNCIL_STOCK = /^A playground on .+'s own list of play areas\.$/;
const OSM_STOCK = /^A playground on OpenStreetMap( near (.+?))?\. No council list we've checked includes it yet/;

/** True when the description is one of the stock lines the coverage check writes (or empty). */
export const isStock = (d: string) => !d.trim() || COUNCIL_STOCK.test(d) || OSM_STOCK.test(d);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = (id: string, salt: string, options: string[]) => options[hash(id + salt) % options.length];

/** About half a mile counts as "easy to try both"; further than a mile is a separate trip. */
const PAIR_KM = 1.6;
const mi = (k: number) => `${(k * 0.621371).toFixed(1)} miles`;

export function whatsHere(p: Park, others: { x: Park; d: number }[], loos: Loos) {
  const stock = isStock(p.description);
  const noEquipment = p.equipment.length === 0;
  const intro: string[] = [];

  if (!stock) {
    intro.push(p.description);
  } else if (p.checked) {
    // On an official list.
    const who = p.operator ? `run by ${p.operator}` : 'on the council’s list';
    intro.push(
      pick(p.id, 'a', [
        `${p.name} is a play area in ${p.area}, ${who}.`,
        `${p.name} is one of the play areas in ${p.area}, ${who}.`,
        `You’ll find ${p.name} in ${p.area}. It’s ${who}.`,
      ]) +
        ' ' +
        (noEquipment
          ? pick(p.id, 'b', [
              'It’s on the council’s own list of play areas, but no parent has told us what’s in it yet.',
              'We know it’s here because it’s on the council’s own list, but we don’t know what equipment it has yet.',
              'The council lists it as a play area, but nobody has told us what’s there yet.',
            ])
          : 'It’s on the council’s own list of play areas.'),
    );
  } else {
    // OpenStreetMap only: keep the caution that it may not be public.
    const near = p.description.match(OSM_STOCK)?.[2];
    intro.push(
      (/^Playground off |\bPlayground$/.test(p.name) ? 'This playground is marked' : `${p.name} is marked as a playground`) +
        ` on OpenStreetMap${near ? `, near ${near}` : ''}. ` +
        pick(p.id, 'b', [
          'We haven’t found it on a council list yet, so we can’t confirm it’s open to everyone or what it has.',
          'It isn’t on any council list we’ve checked, so we don’t yet know whether it’s public or what’s there.',
        ]),
    );
  }

  // Practical bits, for pages that don't already have them.
  if (stock || (p.facilities.length === 0 && p.nearby.length === 0)) {
    const bits: string[] = [];
    const pair = others.find(({ x, d }) => d <= PAIR_KM && !x.fee);
    if (pair) {
      const name = pair.x.name;
      const away = pair.d < 0.16 ? 'right next door' : `${pair.d < 0.8 ? 'just ' : ''}${mi(pair.d)} away`;
      // Names we made up ourselves ("Playground off Mill Lane", "Hatfield Playground") don't work as a proper name.
      const off = name.match(/^Playground off (.+)$/)?.[1];
      bits.push(
        off || /\bPlayground$/.test(name)
          ? `There’s another playground ${away}${off ? `, off ${off}` : ''}, so it’s easy to try both.`
          : pick(p.id, 'c', [
              `There’s another playground at ${name}, ${away}, so it’s easy to try both.`,
              `${name} is another playground ${away}, handy if you fancy a second stop.`,
              `If they’re not ready to go home, ${name} is ${away}.`,
            ]),
      );
    }
    if (loos.onSite) bits.push('There are toilets here.');
    else if (loos.nearest && loos.nearest.m <= 250) bits.push('There are public toilets close by.');
    else if (loos.nearest)
      bits.push(
        pick(p.id, 'd', [
          `The nearest public toilet is about ${mi(loos.nearest.m / 1000)} away, so plan ahead with little ones.`,
          `The nearest public toilet is about ${mi(loos.nearest.m / 1000)} away, so it’s worth going before you set off.`,
        ]),
      );
    else if (loos.known) bits.push('We don’t know of any public toilets within 2 miles, so go before you set off.');
    if (bits.length) intro.push(bits.join(' '));
  }

  // Only ask when we're missing the basics.
  const ask = !p.checked || noEquipment;
  return { intro, ask, summary: intro[0] };
}

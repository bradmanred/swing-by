import { getCollection, type CollectionEntry } from 'astro:content';
import labels from '../data/labels.json';
import regionsFile from '../data/regions.json';
import toiletsFile from '../data/toilets.json';

export type Park = CollectionEntry<'playgrounds'>['data'] & { id: string };

export const L = labels as {
  ages: Record<string, string>;
  equipment: Record<string, string>;
  access: Record<string, string>;
  facilities: Record<string, string>;
  memberships: Record<string, string>;
  nearby: Record<string, string>;
  duskByMonth: string[];
  sizes: Record<string, string>;
};

export const regions = regionsFile.regions;
export const regionName = (id: string) => regions.find((r) => r.id === id)?.name ?? id;

export async function allParks(): Promise<Park[]> {
  const entries = await getCollection('playgrounds');
  return entries
    .map((e) => {
      const d = { ...e.data, id: e.id };
      // Keep the baby change flag and the 'bc' facility in step, whichever one the JSON uses.
      if (d.babyChange === true && !d.facilities.includes('bc')) d.facilities = [...d.facilities, 'bc'];
      if (d.facilities.includes('bc') && d.babyChange == null) d.babyChange = true;
      return d;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
}

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const miles = (k: number) => {
  const mi = k * 0.621371;
  return mi < 0.1 ? 'Under 0.1 mi' : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
};

export const fmtDate = (d: string) =>
  new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function hoursText(p: Park) {
  const bits: string[] = [];
  if (p.opens === '24h') bits.push('Open 24 hours');
  else if (p.opens) bits.push(`Opens ${p.opens}, ${p.closes ? `closes ${p.closes}` : 'locks at dusk'}`);
  else bits.push('Opening times not confirmed. Most parks lock at dusk.');
  if (p.weekendsOnly) bits.push('Weekends and school holidays only.');
  if (p.season) bits.push(`Open ${MONTHS[p.season.from - 1]} to ${MONTHS[p.season.to - 1]}.`);
  return bits.join(' ');
}

export type Loo = { id: string; name: string; m: number; babyChange: boolean | null; accessible: boolean | null; free: boolean | null };
export const toiletSource = toiletsFile.source;
const looFor = (id: string) => (toiletsFile.parks as Record<string, { nearest: Loo | null; nearestBabyChange?: Loo }>)[id];
export const looUrl = (l: Loo) => `https://www.toiletmap.org.uk/loos/${l.id}`;

/**
 * Toilets for a playground page.
 * - onSite: the playground's own sources list toilets. babyChange is from those sources (true, false or null = not known);
 *   when the sources don't say, a Toilet Map toilet within 250 m can fill it in (mapBabyChange).
 * - Otherwise: the nearest toilet from the Toilet Map, plus the nearest one with baby change if that isn't the same toilet.
 */
export function toiletInfo(p: Park) {
  const onSite = p.facilities.includes('wc') || p.nearby.some((n) => n.type === 'toilets');
  const t = looFor(p.id);
  const close = t?.nearest && t.nearest.m <= 250 ? t.nearest : null;
  return {
    onSite,
    babyChange: p.babyChange ?? null,
    mapBabyChange: onSite && p.babyChange == null && close?.babyChange != null ? { loo: close, has: close.babyChange } : null,
    known: !!t,
    nearest: onSite ? null : (t?.nearest ?? null),
    nearestBabyChange: onSite ? null : (t?.nearest?.babyChange === true ? null : (t?.nearestBabyChange ?? null)),
  };
}

/** Decorative icons; the text label is always shown next to them. */
export const ICON: Record<string, string> = {
  sw: '🪢', bs: '👶', sl: '🛝', tp: '🤸', ss: '⚖️', mb: '🐒', cl: '🧗', zw: '🚡', sp: '🏖️', wp: '💦', ad: '🏴‍☠️', rb: '🎠', tr: '🚂', sk: '🛹',
  spr: '🐴', bk: '🧺', gym: '🏋️', mg: '🏀',
  inc: '♿', sf: '♿', sen: '✋', wc: '🚻', bc: '🍼', cf: '☕', fen: '🚧', sh: '🌳', fp: '🅿️',
};

/** Paid entry: the playground costs money to get into (or sits inside somewhere that does). Paid parking alone doesn't count. */
export const paidEntry = (p: Park) => !!p.fee?.trim();

/** The lightweight record the finder script needs in the browser. */
export const clientPark = (p: Park) => ({
  id: p.id,
  n: p.name,
  a: p.area,
  r: p.region,
  lat: p.lat,
  lng: p.lng,
  ages: p.ages,
  f: [...p.equipment, ...p.access, ...p.facilities],
  c: p.checked,
  m: p.membership ?? null,
  d: p.description.slice(0, 140),
  s: p.size ?? null,
  pay: paidEntry(p),
});

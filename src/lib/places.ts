// Pages for browsing playgrounds by place: one for each region (src/data/regions.json), and one for each town or area
// that has enough playgrounds to be worth a page of its own. Used by src/pages/playgrounds/in/ and by the breadcrumbs on
// playground pages, so the two always agree on which pages exist.
import { allParks, paidEntry, regions, toiletInfo, type Park } from './parks';

/** An area gets its own page from this many playgrounds, so no page is nearly empty. */
export const MIN_AREA = 5;
/** A region gets a page from this many playgrounds. */
export const MIN_REGION = 3;

/** "Tiverton, Mid Devon" becomes "tiverton-mid-devon". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export type Area = { name: string; slug: string; parks: Park[] };
export type Place = { id: string; name: string; parks: Park[]; areas: Area[]; rest: Park[] };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en-GB');

/** Every region with a page, with its areas (those with a page of their own) and the playgrounds left over. Worked out once per build. */
let cache: Promise<Place[]> | undefined;
export const places = () => (cache ??= build());

/** Which region page, and which area page if it has one, a playground belongs to. */
let index: Promise<Map<string, { place: Place; area: Area | null }>> | undefined;
export const locate = async (id: string) => {
  index ??= places().then((all) => {
    const m = new Map<string, { place: Place; area: Area | null }>();
    for (const place of all) {
      for (const area of place.areas) for (const p of area.parks) m.set(p.id, { place, area });
      for (const p of place.rest) m.set(p.id, { place, area: null });
    }
    return m;
  });
  return (await index).get(id) ?? null;
};

async function build(): Promise<Place[]> {
  const parks = await allParks();
  const out: Place[] = [];
  for (const r of regions) {
    const inRegion = parks.filter((p) => p.region === r.id);
    if (inRegion.length < MIN_REGION) continue;
    const groups = new Map<string, Park[]>();
    for (const p of inRegion) {
      const key = p.area.trim();
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const areas: Area[] = [];
    const taken = new Set<string>();
    for (const [name, ps] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'en-GB'))) {
      if (ps.length < MIN_AREA || !slug(name)) continue;
      // Two names that make the same address get a number on the end, so pages never overwrite each other.
      let s = slug(name);
      for (let n = 2; taken.has(s); n++) s = `${slug(name)}-${n}`;
      taken.add(s);
      areas.push({ name, slug: s, parks: ps });
    }
    const listed = new Set(areas.flatMap((a) => a.parks.map((p) => p.id)));
    out.push({ id: r.id, name: r.name, parks: inRegion, areas, rest: inRegion.filter((p) => !listed.has(p.id)) });
  }
  return out;
}

// Regions that read better with "the" in front: "Playgrounds in the South East".
const THE = new Set(['east', 'south-east', 'south-west', 'north-east', 'north-west', 'east-midlands', 'west-midlands']);
/** How a region is named in a sentence or title. */
export const inRegionName = (p: Pick<Place, 'id' | 'name'>) => (THE.has(p.id) ? `the ${p.name}` : p.name);

export const regionUrl = (regionId: string) => `/playgrounds/in/${regionId}/`;
export const areaUrl = (regionId: string, area: Area) => `/playgrounds/in/${regionId}/${area.slug}/`;

/** Counts for the sentence at the top of a place page. Only things the data actually says. */
export function summarise(parks: Park[]) {
  const free = parks.filter((p) => !paidEntry(p)).length;
  return {
    total: parks.length,
    checked: parks.filter((p) => p.checked).length,
    toilets: parks.filter((p) => toiletInfo(p).onSite).length,
    babyChange: parks.filter((p) => p.babyChange === true).length,
    free,
    paid: parks.length - free,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** One plain sentence per fact, skipping any that would be zero. */
export function summaryLines(parks: Park[], place: string) {
  const s = summarise(parks);
  const n = (x: number) => x.toLocaleString('en-GB');
  const open = s.total - s.checked;
  const first = `Swing By lists ${plural(s.total, 'playground')} in ${place}.`;
  const checked =
    s.total === 1
      ? s.checked ? 'It has been checked against the council\'s or operator\'s own website.' : 'It hasn\'t been checked against an official source yet, so it\'s marked "Unverified".'
      : open === 0 ? `All of them have been checked against the council's or operator's own website.`
      : s.checked === 0 ? `None has been checked against an official source yet, so all are marked "Unverified".`
      : `${n(s.checked)} ${s.checked === 1 ? 'has' : 'have'} been checked against the council's or operator's own website; the other ${n(open)} ${open === 1 ? 'is' : 'are'} marked "Unverified".`;
  const lines = [`${first} ${checked}`];
  if (s.toilets) lines.push(`${plural(s.toilets, 'playground')} ${s.toilets === 1 ? 'has' : 'have'} toilets at or next to the playground, and ${s.babyChange ? `${s.babyChange.toLocaleString('en-GB')} ${s.babyChange === 1 ? 'is' : 'are'} listed with baby change` : 'none is listed with baby change yet'}.`);
  lines.push(
    s.paid === 0
      ? s.total === 1 ? 'It is free to enter.' : 'All are free to enter.'
      : s.free === 0
        ? s.total === 1 ? 'It charges for entry.' : 'All charge for entry.'
        : `${n(s.free)} ${s.free === 1 ? 'is' : 'are'} free to enter, and ${n(s.paid)} charge${s.paid === 1 ? 's' : ''} for entry.`,
  );
  return lines;
}

/** "Tiverton, Mid Devon" already says where it is; "Exeter" gets the region added: "Exeter, Devon". */
export const areaLabel = (area: Pick<Area, 'name'>, place: Pick<Place, 'name'>) =>
  area.name.toLowerCase().includes(place.name.toLowerCase()) ? area.name : `${area.name}, ${place.name}`;

/** Breadcrumb trail for search engines. Each item is [name, path on this site]. */
export const breadcrumbLd = (site: URL | undefined, items: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: new URL(path, site).href })),
});

/** A shortened description for a list: whole words, ending in an ellipsis if cut. */
export const blurb = (text: string, max = 170) => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
};

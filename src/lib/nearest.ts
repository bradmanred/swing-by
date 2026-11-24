// The nearest few playgrounds to each playground, worked out once for the whole build.
// Checking every playground against every other one on each page took most of the build time
// (about 1.7 billion distance sums at 41,700 playgrounds), so this sorts them by latitude and,
// for each one, only looks north and south until nothing further away in latitude could be closer.
// Results match the old way exactly: nearest first, with ties in the order of the list passed in.

type Point = { id: string; lat: number; lng: number };

// Same great-circle distance as km() in parks.ts (kept here so this file has no Astro imports).
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Two places can't be closer than their difference in latitude, measured along a meridian.
const KM_PER_DEGREE = (12742 / 2) * (Math.PI / 180);

export function nearestOthers<T extends Point>(parks: T[], count: number): Map<string, { x: T; d: number }[]> {
  const order = parks.map((_, i) => i).sort((a, b) => parks[a].lat - parks[b].lat);
  const out = new Map<string, { x: T; d: number }[]>();
  for (let pos = 0; pos < order.length; pos++) {
    const pi = order[pos];
    const p = parks[pi];
    const best: { i: number; d: number }[] = []; // kept sorted by distance, then list order
    const consider = (i: number) => {
      if (i === pi || parks[i].id === p.id) return;
      const d = km(p, parks[i]);
      if (best.length === count) {
        const w = best[count - 1];
        if (d > w.d || (d === w.d && i > w.i)) return;
      }
      let at = best.length;
      while (at > 0 && (best[at - 1].d > d || (best[at - 1].d === d && best[at - 1].i > i))) at--;
      best.splice(at, 0, { i, d });
      if (best.length > count) best.pop();
    };
    // A place whose latitude gap alone is more than the current worst can't get in; one at exactly
    // that distance still can (it might tie and come earlier in the list), so keep going until it's over.
    const done = (q: number) => best.length === count && Math.abs(parks[q].lat - p.lat) * KM_PER_DEGREE > best[count - 1].d;
    let up = pos + 1;
    let down = pos - 1;
    while (up < order.length || down >= 0) {
      if (up < order.length) {
        if (done(order[up])) up = order.length;
        else consider(order[up++]);
      }
      if (down >= 0) {
        if (done(order[down])) down = -1;
        else consider(order[down--]);
      }
    }
    out.set(p.id, best.map(({ i, d }) => ({ x: parks[i], d })));
  }
  return out;
}

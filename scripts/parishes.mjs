// Parish helpers shared by scripts/parish-queue.mjs and its tests: loose name matching and a point-in-parish lookup
// over the parish outlines in the OpenStreetMap snapshot (osm-areas.json: { n: name, k: kind, bb: box, r: rings }).

/** Parish names compared loosely: "St. Neots" = "St Neots", "Belper CP" = "Belper", "Bury St Edmunds Town Council" = "Bury St Edmunds". */
export const parishKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bcp\b|\b(?:town|parish|city|community|village|neighbourhood)\s+council\b|\bcouncil\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();

/** Whether (x, y) is inside a ring given as a flat [x1, y1, x2, y2, …] list. */
export function inRing(x, y, r) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A lookup from a point to the parish it's in, over the snapshot's areas ({ n, k, bb, r }). */
export function parishFinder(areas) {
  const parishes = areas.filter((a) => a.k === 'parish');
  const grid = new Map();
  parishes.forEach((a, i) => {
    const [x0, y0, x1, y1] = a.bb;
    for (let gx = Math.floor(x0 * 10); gx <= Math.floor(x1 * 10); gx++)
      for (let gy = Math.floor(y0 * 10); gy <= Math.floor(y1 * 10); gy++) {
        const k = `${gx},${gy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  return (lng, lat) => {
    for (const i of grid.get(`${Math.floor(lng * 10)},${Math.floor(lat * 10)}`) ?? []) {
      const a = parishes[i];
      const [x0, y0, x1, y1] = a.bb;
      if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
      // Holes are rings too: inside an odd number of rings is inside the parish.
      if (a.r.filter((r) => inRing(lng, lat, r)).length % 2 === 1) return a.n;
    }
    return null;
  };
}

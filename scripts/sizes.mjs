// Play area sizes from a council's own grading (docs/finding-playgrounds.md): the Fields in Trust grades, where
// LAP (Local Area for Play) = small, LEAP (Local Equipped Area for Play) = medium and NEAP (Neighbourhood Equipped
// Area for Play) = large, or a council's own small / medium / large categories given in a list's "size" column.
// Used by the council feeds (new playgrounds), scripts/apply-sizes.mjs (existing ones) and scripts/size-gaps.mjs.

export const SIZES = ['small', 'medium', 'large'];

// Abbreviations only in capitals, so everyday words ("a leap", "on your lap") don't count; the full names in any case.
const GRADES = [
  ['large', /\bNEAPs?\b/, /\bneighbourhood equipped areas? (?:for|of) play\b/i],
  ['medium', /\bLEAPs?\b/, /\blocal(?:ly)? equipped areas? (?:for|of) play\b/i],
  ['small', /\bLAPs?\b/, /\blocal areas? (?:for|of) play\b/i],
];

/**
 * The size a piece of council text grades a play area as, or null. When it names more than one grade (a NEAP with a
 * LAP for toddlers), the largest wins: the size is the whole site's.
 */
export function gradeOf(text) {
  const t = String(text ?? '');
  for (const [size, abbr, full] of GRADES) if (abbr.test(t) || full.test(t)) return size;
  return null;
}

/** A council's own size value (a "size" column: "Small", "medium", "LEAP"…) as one of SIZES, or null. */
export function sizeValue(v) {
  const s = String(v ?? '').trim();
  return SIZES.includes(s.toLowerCase()) ? s.toLowerCase() : gradeOf(s);
}

// Google Analytics events for searches. See Analytics.astro and CookieBar.astro for how consent works.
//
// - Nothing is sent unless the visitor accepted analytics in the consent bar, so there is no tracking before consent.
// - A full postcode is never sent. It can point at one household, so the last two characters are dropped
//   ("AL1 3AF" is sent as "AL1 3", a postcode sector that covers a few thousand homes). The same cut-back is
//   applied to a postcode typed anywhere inside a search phrase.

type Params = Record<string, string | number>;

export function track(name: string, params: Params) {
  try {
    if (localStorage.getItem('sb-consent') !== 'granted') return;
  } catch {
    return;
  }
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag === 'function') gtag('event', name, params);
}

/** "AL1 3AF" or "al13af" gives "AL1 3"; a postcode area such as "AL1" stays "AL1". Anything that isn't a postcode gives null. */
export function postcodeSector(s: string): string | null {
  const pc = s.toUpperCase().replace(/\s+/g, '');
  const full = /^([A-Z]{1,2}\d[A-Z\d]?)(\d)[A-Z]{2}$/.exec(pc);
  if (full) return `${full[1]} ${full[2]}`;
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc) ? pc : null;
}

/** What is safe to send for something typed in a search box: tidy, lower case, short, and no full postcodes. */
export function searchTerm(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d)[A-Z]{2}\b/gi, '$1 $2')
    .toLowerCase()
    .slice(0, 100);
}

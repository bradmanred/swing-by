// Small wrapper so private browsing or blocked storage never breaks the page.
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// v: been here, r: rating, t: date last changed, fav: saved as a favourite. All kept on this device only.
export type Mine = Record<string, { v?: boolean; r?: number; t?: string; fav?: boolean }>;
export const getMine = () => {
  const mine = store.get<Mine>('sb-mine', {});
  // Playground ids used to start with "c-". Move anything saved under an old id to the new one, once.
  const old = Object.keys(mine).filter((k) => k.startsWith('c-'));
  if (old.length) {
    for (const k of old) {
      const id = k.slice(2);
      mine[id] = { ...mine[k], ...mine[id] };
      delete mine[k];
    }
    store.set('sb-mine', mine);
  }
  return mine;
};

/** Turn a playground's favourite on or off, keeping whatever else is saved for it. */
export function setFav(id: string, on: boolean) {
  const mine = getMine();
  mine[id] = { ...mine[id], fav: on || undefined };
  store.set('sb-mine', mine);
}

const favLabel = (on: boolean, name: string) => (on ? `Remove ${name} from favourites` : `Save ${name} to favourites`);

/**
 * Heart buttons ([data-fav] with data-name) anywhere on the page: shows the saved state and toggles it.
 * One listener on the document, so cards added later work too.
 */
export function startFavs(onChange?: () => void) {
  const sync = (root: ParentNode = document) => {
    const mine = getMine();
    root.querySelectorAll<HTMLButtonElement>('[data-fav]').forEach((b) => {
      const on = !!mine[b.dataset.fav!]?.fav;
      b.setAttribute('aria-pressed', String(on));
      const t = b.querySelector('.fav-text');
      // Buttons with visible text keep it as their name (aria-pressed says whether it's on); icon-only hearts get a label.
      if (t) t.textContent = 'Favourite';
      else b.setAttribute('aria-label', favLabel(on, b.dataset.name ?? 'this playground'));
    });
  };
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fav]');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    setFav(b.dataset.fav!, on);
    sync();
    const live = document.getElementById('fav-status');
    if (live) live.textContent = on ? `${b.dataset.name} saved to your favourites on this device.` : `${b.dataset.name} removed from your favourites.`;
    onChange?.();
  });
  sync();
  return sync;
}

import { cardHTML, esc, fmtMiles, type CardPhoto, type ClientPark } from '../lib/card';
import { store, getMine, startFavs } from './store';
import { track, postcodeSector } from './track';

// 'example' is the starting point before someone tells us where they are.
type Origin = { name: string; lat: number; lng: number; acc: number; how: 'town' | 'postcode' | 'gps' | 'example' };
type Town = { name: string; lat: number; lng: number; r: string };

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const PAGE = 12;
const HIDDEN_KM = 4.83; // 3 miles: how far to look when saying how many unverified playgrounds are hidden

/**
 * While splash parks are switched on, roughly April to September (Stanborough Park's Splashlands opens in early April,
 * weather permitting, and closes on the last Sunday in September), bring Splash play up from "More filters" into the
 * main list, in its usual most-common-first place. The least common filter that isn't pinned (Miniature railway is
 * always shown) moves down to make room.
 */
export function summerFilters(today = new Date()) {
  const m = today.getMonth();
  if (m < 3 || m > 8) return; // April (3) to September (8)
  const top = document.querySelector('.loves > .row');
  const more = document.querySelector('#more-filters .row');
  const splash = more?.querySelector<HTMLElement>('[data-season=summer]');
  if (!top || !more || !splash) return;
  const bump = [...top.querySelectorAll<HTMLElement>('[data-love]:not([data-pin])')].pop();
  if (bump) more.prepend(bump);
  const n = Number(splash.dataset.n);
  const after = [...top.querySelectorAll<HTMLElement>('[data-love]')].find((b) => Number(b.dataset.n) < n) ?? null;
  top.insertBefore(splash, after);
  if (!more.children.length) more.closest('details')?.remove();
}

/** onPhotos hears the approved parent photos once they've loaded (an empty list if they couldn't be loaded). */
export function startFinder(o: { onPhotos?: (photos: Record<string, CardPhoto>, parks: ClientPark[]) => void } = {}) {
  const { parks, towns } = JSON.parse($('#parks-data').textContent!) as { parks: ClientPark[]; towns: Town[] };
  const first = towns[0];
  const st = {
    origin: store.get<Origin>('sb-origin', { name: first.name, lat: first.lat, lng: first.lng, acc: 1500, how: 'example' }),
    ages: new Set<string>(),
    sizes: new Set<string>(),
    loves: new Set<string>(),
    freeOnly: store.get<boolean>('sb-free-only', false),
    hideUnverified: store.get<boolean>('sb-hide-unverified', false),
    // Playgrounds two parents confirm are there count as verified (filled in from /api/equipment/open).
    parentOk: new Set<string>(),
    sort: 'near',
    limit: PAGE,
    photos: {} as Record<string, CardPhoto>,
    // Set when someone moves the map themselves: results then centre on the map instead of on them.
    area: null as null | { lat: number; lng: number; bounds: Bounds },
  };
  const hint = $('#where-hint');
  const where = $<HTMLInputElement>('#where');
  where.value = st.origin.how === 'gps' || st.origin.how === 'example' ? '' : st.origin.name;
  let map: MapView | null = null;
  // Each lookup gets a number so a slow answer (often "Near me") can't overwrite a newer search.
  let lookup = 0;
  let syncFavs: ((root?: ParentNode) => void) | undefined;

  const verified = (p: ClientPark) => !!p.c || st.parentOk.has(p.id);

  /** Everything the other filters allow, before "Hide unverified places". */
  function matching() {
    return parks
      .filter((p) => !st.ages.size || p.ages.some((a) => st.ages.has(a)))
      .filter((p) => [...st.loves].every((k) => p.f.includes(k)))
      .filter((p) => !st.sizes.size || (p.s != null && st.sizes.has(p.s)))
      .filter((p) => !st.freeOnly || !p.pay);
  }

  function list() {
    const mine = getMine();
    let rows = matching()
      .filter((p) => !st.hideUnverified || verified(p))
      .map((p) => ({ p, d: km(st.area ?? st.origin, p), m: mine[p.id] }));
    if (st.sort === 'new') rows = rows.filter((x) => !x.m?.v);
    if (st.sort === 'fav') rows = rows.filter((x) => x.m?.fav);
    rows.sort((a, b) => (st.sort === 'rated' ? (b.m?.r ?? 0) - (a.m?.r ?? 0) || a.d - b.d : a.d - b.d));
    return rows;
  }

  function render(announce = true) {
    const rows = list();
    const label = st.origin.how === 'gps' ? 'you' : st.origin.name;
    $('#results-title').textContent = st.area ? 'Playgrounds in this map area' : st.origin.how === 'example' ? `Playgrounds near ${label}, as an example` : `Playgrounds near ${label}`;
    $('#near-title').textContent = st.area ? 'Parks in this area' : 'Parks near you';
    $('#cards').innerHTML = rows
      .slice(0, st.limit)
      .map((x, i) => cardHTML(x.p, { dist: x.d, num: i < 5 ? i + 1 : undefined, mine: x.m, photo: st.photos[x.p.id], parents: st.parentOk.has(x.p.id) }))
      .join('');
    queueMicrotask(() => syncFavs?.());
    $('#nearlist').innerHTML = rows
      .slice(0, 5)
      .map(
        (x, i) =>
          `<li><a href="/playgrounds/${esc(x.p.id)}/" data-num="${i + 1}"><span class="num" aria-hidden="true">${i + 1}</span><span>${esc(x.p.n)}${x.p.pay ? ' <span class="pound" aria-hidden="true">£</span><span class="sr-only">, paid entry</span>' : ''}</span><span class="dist">${fmtMiles(x.d)}</span></a></li>`,
      )
      .join('') || '<li>No playgrounds match those choices. Try removing a filter.</li>';
    // Say how many nearby playgrounds the filter is hiding, so an area never looks emptier than it is.
    const note = $('#unverified-note');
    const hidden = st.hideUnverified ? matching().filter((p) => !verified(p) && km(st.area ?? st.origin, p) <= HIDDEN_KM).length : 0;
    note.hidden = !hidden;
    if (hidden)
      note.innerHTML = `${hidden} unverified ${hidden === 1 ? 'playground' : 'playgrounds'} within 3 miles ${hidden === 1 ? 'is' : 'are'} hidden. <button type="button" class="linkbtn" id="show-unverified">Show ${hidden === 1 ? 'it' : 'them'}</button>`;
    const more = $<HTMLButtonElement>('#more');
    more.hidden = rows.length <= st.limit;
    if (announce)
      $('#count').textContent = st.sort === 'fav'
        ? rows.length
          ? `${rows.length} of your favourites, nearest first.`
          : 'No favourites yet. Tap the heart on any playground to save it for next time.'
        : st.area
        ? `${rows.length} playgrounds found, nearest to the middle of the map first.`
        : `${rows.length} playgrounds found, nearest first${st.sort === 'near' ? '' : ' after sorting'}.`;
    const cap = $('#where-caption');
    if (st.area) {
      cap.innerHTML = `<strong>Showing playgrounds around the middle of the map.</strong> <button type="button" class="linkbtn" id="back-to-origin">Back to ${esc(st.origin.how === 'gps' ? 'where you are' : st.origin.name)}</button>`;
    } else {
      const sure =
        st.origin.acc <= 150 ? 'The circle shows how sure we are.' : st.origin.acc <= 2500 ? 'The circle shows roughly where we think you are.' : 'This is only a rough guess.';
      cap.innerHTML =
        st.origin.how === 'example'
          ? `<strong>Enter your town or postcode, or tap Near me,</strong> to see playgrounds near you. Until then, here's ${esc(st.origin.name)} as an example.`
          : `<strong>We think you're near ${esc(st.origin.name)}.</strong> ${sure}`;
    }
    const top = rows.slice(0, 5).map((x) => x.p);
    // Also mark the other playgrounds in view, so moving the map shows everything there.
    const b = st.area?.bounds;
    const inView = b
      ? rows
          .slice(5)
          .filter((x) => x.p.lat <= b.n && x.p.lat >= b.s && x.p.lng <= b.e && x.p.lng >= b.w)
          .slice(0, 80)
          .map((x) => x.p)
      : [];
    map?.update(st.origin, top, { fit: !st.area, more: inView });
  }

  async function resolve(q: string): Promise<Origin | null> {
    const s = q.trim();
    if (!s) return null;
    const town = towns.find((t) => t.name.toLowerCase() === s.toLowerCase());
    if (town) return { name: town.name, lat: town.lat, lng: town.lng, acc: 1500, how: 'town' };
    const pc = s.toUpperCase().replace(/\s+/g, '');
    const api = 'https://api.postcodes.io';
    if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
      const r = await fetch(`${api}/postcodes/${pc}`);
      if (!r.ok) throw new Error(`We couldn't find the postcode ${s.toUpperCase()}. Check it and try again.`);
      const j = (await r.json()).result;
      return { name: j.postcode, lat: j.latitude, lng: j.longitude, acc: 100, how: 'postcode' };
    }
    if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc)) {
      const r = await fetch(`${api}/outcodes/${pc}`);
      if (!r.ok) throw new Error(`We couldn't find the postcode area ${pc}.`);
      const j = (await r.json()).result;
      return { name: j.outcode, lat: j.latitude, lng: j.longitude, acc: 3000, how: 'postcode' };
    }
    const r = await fetch(`${api}/places?q=${encodeURIComponent(s)}&limit=1`);
    const j = r.ok ? (await r.json()).result?.[0] : null;
    if (!j) throw new Error(`We couldn't find ${s}. Try a town name or a postcode.`);
    return { name: j.name_1, lat: j.latitude, lng: j.longitude, acc: 2000, how: 'town' };
  }

  function setOrigin(o: Origin) {
    st.origin = o;
    st.area = null;
    st.limit = PAGE;
    store.set('sb-origin', o);
    render();
  }

  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mine = ++lookup;
    const btn = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('[type=submit]')!;
    btn.disabled = true;
    hint.classList.remove('err');
    hint.textContent = 'Looking that up…';
    try {
      const o = await resolve(where.value);
      if (mine !== lookup) return;
      if (o) {
        setOrigin(o);
        // The postcode goes to Analytics without its last two characters (see track.ts), and only after consent.
        // Towns are sent by their proper name (so "st albans" and "St Alban's" count together), never what was typed.
        const pc = o.how === 'postcode' ? postcodeSector(where.value) : null;
        if (pc) track('postcode_search', { postcode: pc });
        else if (o.how === 'town') track('town_search', { town: o.name });
        hint.textContent = `Showing playgrounds near ${o.name}.`;
        $('#near-title').scrollIntoView({ block: 'start' });
      } else hint.textContent = 'Enter a town or postcode first.';
    } catch (err) {
      if (mine !== lookup) return;
      hint.classList.add('err');
      hint.textContent = err instanceof Error && err.message.startsWith('We ') ? err.message : "We couldn't look that up just now. Check your connection and try again.";
    } finally {
      btn.disabled = false;
    }
  });

  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) {
      hint.textContent = "Your browser can't share your location. Enter a postcode instead.";
      return;
    }
    hint.classList.remove('err');
    hint.textContent = 'Finding you… your browser may ask for permission.';
    const mine = ++lookup;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (mine !== lookup) return;
        const o: Origin = { name: 'your location', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, how: 'gps' };
        try {
          const r = await fetch(`https://api.postcodes.io/postcodes?lon=${o.lng}&lat=${o.lat}&limit=1`);
          const pc = r.ok ? (await r.json()).result?.[0]?.postcode : null;
          if (pc) o.name = pc;
        } catch {}
        if (mine !== lookup) return;
        where.value = '';
        setOrigin(o);
        hint.textContent = `Found you, accurate to about ${Math.max(10, Math.round(o.acc / 10) * 10)} metres.`;
        // Hop down to the map so the nearest playgrounds are in view.
        document.querySelector('.mapbox')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      },
      () => {
        if (mine !== lookup) return;
        hint.classList.add('err');
        hint.textContent = "We couldn't get your location. Enter a town or postcode instead.";
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });

  $('#where-caption').addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#back-to-origin')) return;
    st.area = null;
    st.limit = PAGE;
    render();
  });

  $('#change').addEventListener('click', () => {
    where.focus();
    where.select();
  });

  document.querySelectorAll<HTMLInputElement>('input[name=age]').forEach((c) =>
    c.addEventListener('change', () => {
      c.checked ? st.ages.add(c.value) : st.ages.delete(c.value);
      st.limit = PAGE;
      render();
    }),
  );
  document.querySelectorAll<HTMLInputElement>('input[name=size]').forEach((c) =>
    c.addEventListener('change', () => {
      c.checked ? st.sizes.add(c.value) : st.sizes.delete(c.value);
      st.limit = PAGE;
      render();
    }),
  );
  const unv = document.querySelector<HTMLInputElement>('#hide-unverified');
  const setHide = (on: boolean) => {
    st.hideUnverified = on;
    if (unv) unv.checked = on;
    store.set('sb-hide-unverified', on);
    st.limit = PAGE;
    render();
  };
  if (unv) {
    unv.checked = st.hideUnverified;
    unv.addEventListener('change', () => setHide(unv.checked));
  }
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#show-unverified')) {
      setHide(false);
      unv?.focus();
    }
  });
  const free = document.querySelector<HTMLInputElement>('#free-only');
  if (free) {
    free.checked = st.freeOnly;
    free.addEventListener('change', () => {
      st.freeOnly = free.checked;
      store.set('sb-free-only', st.freeOnly);
      st.limit = PAGE;
      render();
    });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-love]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.love!;
      const on = !st.loves.has(k);
      on ? st.loves.add(k) : st.loves.delete(k);
      b.setAttribute('aria-pressed', String(on));
      st.limit = PAGE;
      render();
    }),
  );
  $<HTMLSelectElement>('#sort').addEventListener('change', (e) => {
    st.sort = (e.target as HTMLSelectElement).value;
    render();
  });
  $('#more').addEventListener('click', () => {
    const before = st.limit;
    st.limit += PAGE;
    render(false);
    document.querySelectorAll<HTMLAnchorElement>('#cards h3 a')[before]?.focus();
  });

  // Hearts on cards: saved on this device. Started once, here; render() re-syncs them whenever the cards are redrawn.
  syncFavs = startFavs(() => st.sort === 'fav' && render());
  render(false);

  // Playgrounds parents have confirmed count as verified, and say so on their cards.
  fetch('/api/equipment/open')
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((j: { parks: string[] } | null) => {
      if (j?.parks?.length) {
        st.parentOk = new Set(j.parks);
        render(false);
      }
    })
    .catch(() => {});

  // Approved parent photos replace the illustrations on cards. Without them the illustrations stay.
  fetch('/api/photos/approved')
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((photos: Record<string, CardPhoto> | null) => {
      if (photos && Object.keys(photos).length) {
        st.photos = photos;
        render(false);
      }
      o.onPhotos?.(photos ?? {}, parks);
    })
    .catch(() => o.onPhotos?.({}, parks));

  // The map is an extra; everything above works without it.
  import('./map')
    .then(({ createMap }) => {
      map = createMap(
        $('#map'),
        (id) => {
          const link = document.querySelector<HTMLAnchorElement>(`#card-${CSS.escape(id)} h3 a`);
          link?.scrollIntoView({ block: 'center' });
          link?.focus({ preventScroll: true });
        },
        // Someone moved the map: search that area straight away.
        (centre, bounds) => {
          st.area = { ...centre, bounds };
          st.limit = PAGE;
          render();
        },
      );
      if (map) render(false);
    })
    .catch(() => {
      $('#map').innerHTML = '<p class="nojs">The map could not load. The list of nearby parks still works.</p>';
    });
}

export type Bounds = { n: number; s: number; e: number; w: number };
export type MapView = {
  update(o: { lat: number; lng: number; acc: number; name: string }, top: ClientPark[], opts?: { fit?: boolean; more?: ClientPark[] }): void;
};

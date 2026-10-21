import { cardHTML, esc, fmtMiles, type CardPhoto, type ClientPark } from '../lib/card';
import { store, getMine } from './store';

type Origin = { name: string; lat: number; lng: number; acc: number; how: 'town' | 'postcode' | 'gps' };
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

export function startFinder() {
  const { parks, towns } = JSON.parse($('#parks-data').textContent!) as { parks: ClientPark[]; towns: Town[] };
  const first = towns[0];
  const st = {
    origin: store.get<Origin>('sb-origin', { name: first.name, lat: first.lat, lng: first.lng, acc: 1500, how: 'town' }),
    ages: new Set<string>(),
    loves: new Set<string>(),
    sort: 'near',
    limit: PAGE,
    photos: {} as Record<string, CardPhoto>,
    // Set when someone moves the map themselves: results then centre on the map instead of on them.
    area: null as null | { lat: number; lng: number; bounds: Bounds },
  };
  const hint = $('#where-hint');
  const where = $<HTMLInputElement>('#where');
  where.value = st.origin.how === 'gps' ? '' : st.origin.name;
  let map: MapView | null = null;
  // Each lookup gets a number so a slow answer (often "Near me") can't overwrite a newer search.
  let lookup = 0;

  function list() {
    const mine = getMine();
    let rows = parks
      .filter((p) => !st.ages.size || p.ages.some((a) => st.ages.has(a)))
      .filter((p) => [...st.loves].every((k) => p.f.includes(k)))
      .map((p) => ({ p, d: km(st.area ?? st.origin, p), m: mine[p.id] }));
    if (st.sort === 'new') rows = rows.filter((x) => !x.m?.v);
    rows.sort((a, b) => (st.sort === 'rated' ? (b.m?.r ?? 0) - (a.m?.r ?? 0) || a.d - b.d : a.d - b.d));
    return rows;
  }

  function render(announce = true) {
    const rows = list();
    const label = st.origin.how === 'gps' ? 'you' : st.origin.name;
    $('#results-title').textContent = st.area ? 'Playgrounds in this map area' : `Playgrounds near ${label}`;
    $('#near-title').textContent = st.area ? 'Parks in this area' : 'Parks near you';
    $('#cards').innerHTML = rows
      .slice(0, st.limit)
      .map((x, i) => cardHTML(x.p, { dist: x.d, num: i < 5 ? i + 1 : undefined, mine: x.m, photo: st.photos[x.p.id] }))
      .join('');
    $('#nearlist').innerHTML = rows
      .slice(0, 5)
      .map(
        (x, i) =>
          `<li><a href="/playgrounds/${esc(x.p.id)}/" data-num="${i + 1}"><span class="num" aria-hidden="true">${i + 1}</span><span>${esc(x.p.n)}</span><span class="dist">${fmtMiles(x.d)}</span></a></li>`,
      )
      .join('') || '<li>No playgrounds match those choices. Try removing a filter.</li>';
    const more = $<HTMLButtonElement>('#more');
    more.hidden = rows.length <= st.limit;
    if (announce)
      $('#count').textContent = st.area
        ? `${rows.length} playgrounds found, nearest to the middle of the map first.`
        : `${rows.length} playgrounds found, nearest first${st.sort === 'near' ? '' : ' after sorting'}.`;
    const cap = $('#where-caption');
    if (st.area) {
      cap.innerHTML = `<strong>Showing playgrounds around the middle of the map.</strong> <button type="button" class="linkbtn" id="back-to-origin">Back to ${esc(st.origin.how === 'gps' ? 'where you are' : st.origin.name)}</button>`;
    } else {
      const sure =
        st.origin.acc <= 150 ? 'The circle shows how sure we are.' : st.origin.acc <= 2500 ? 'The circle shows roughly where we think you are.' : 'This is only a rough guess.';
      cap.innerHTML = `<strong>We think you're near ${esc(st.origin.name)}.</strong> ${sure}`;
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

  render(false);

  // Approved parent photos replace the illustrations on cards. Without them the illustrations stay.
  fetch('/api/photos/approved')
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((photos: Record<string, CardPhoto> | null) => {
      if (photos && Object.keys(photos).length) {
        st.photos = photos;
        render(false);
      }
    })
    .catch(() => {});

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

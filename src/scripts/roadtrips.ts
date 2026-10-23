// Road trips: find the junctions nearest to someone, and the playgrounds within about 5 minutes of each.
import { esc, fmtMiles } from '../lib/card';
import { store } from './store';

type J = { n: string; s: string; lat: number; lng: number };
type P = { id: string; n: string; a: string; lat: number; lng: number; wc: boolean; pay: boolean; c: boolean };
type Town = { name: string; lat: number; lng: number };
type Where = { name: string; lat: number; lng: number };

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** A town from our list, a postcode, a postcode district, or a place name, via postcodes.io. */
async function resolve(q: string, towns: Town[]): Promise<Where | null> {
  const s = q.trim();
  if (!s) return null;
  const town = towns.find((t) => t.name.toLowerCase() === s.toLowerCase());
  if (town) return town;
  const pc = s.toUpperCase().replace(/\s+/g, '');
  const api = 'https://api.postcodes.io';
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
    const r = await fetch(`${api}/postcodes/${pc}`);
    if (!r.ok) throw new Error(`We couldn't find the postcode ${s.toUpperCase()}. Check it and try again.`);
    const j = (await r.json()).result;
    return { name: j.postcode, lat: j.latitude, lng: j.longitude };
  }
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(pc)) {
    const r = await fetch(`${api}/outcodes/${pc}`);
    if (!r.ok) throw new Error(`We couldn't find the postcode area ${pc}.`);
    const j = (await r.json()).result;
    return { name: j.outcode, lat: j.latitude, lng: j.longitude };
  }
  const r = await fetch(`${api}/places?q=${encodeURIComponent(s)}&limit=1`);
  const j = r.ok ? (await r.json()).result?.[0] : null;
  if (!j) throw new Error(`We couldn't find ${s}. Try a town name or a postcode.`);
  return { name: j.name_1, lat: j.latitude, lng: j.longitude };
}

export function startRoadTrips() {
  const data = JSON.parse(document.getElementById('rt-data')!.textContent!) as { junctions: J[]; parks: P[]; towns: Town[]; radius: number };
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = $<HTMLFormElement>('jf');
  const where = $<HTMLInputElement>('jf-where');
  const hint = $('jf-hint');
  const out = $('jf-results');
  const free = $<HTMLInputElement>('free-only');
  let origin: Where | null = null;
  let picked = 0;
  let lookup = 0;

  const playgroundsNear = (j: J) =>
    data.parks
      .filter((p) => !(free.checked && p.pay))
      .map((p) => ({ p, d: km(j, p) }))
      .filter((x) => x.d <= data.radius)
      .sort((a, b) => a.d - b.d);

  function show() {
    if (!origin) return;
    const near = data.junctions
      .map((j) => ({ j, d: km(origin!, j) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    if (!near.length) {
      out.innerHTML = '<p>We have no junctions listed yet.</p>';
      return;
    }
    const cur = near[Math.min(picked, near.length - 1)];
    const list = playgroundsNear(cur.j);
    const items = list
      .slice(0, 6)
      .map(
        ({ p, d }) =>
          `<li><a href="/playgrounds/${esc(p.id)}/">${esc(p.n)}</a>, ${esc(p.a)} · <strong>${fmtMiles(d)}</strong> from the junction${p.wc ? ', toilets' : ''}${p.pay ? ', <span class="pay-tag"><span class="pound" aria-hidden="true">£</span> paid entry</span>' : ''}${p.c ? '' : ' (Unverified)'}</li>`,
      )
      .join('');
    const others = near
      .map((x, i) =>
        i === picked
          ? ''
          : `<li><button type="button" class="linkbtn" data-pick="${i}">${esc(x.j.n)}</button>${x.j.s ? ` <span class="hint">${esc(x.j.s)}</span>` : ''} · ${fmtMiles(x.d)} from ${esc(origin!.name)} · ${playgroundsNear(x.j).length} playgrounds</li>`,
      )
      .join('');
    out.innerHTML = `<div class="jf-best">
<h3 tabindex="-1" id="jf-best">${esc(cur.j.n)}${cur.j.s ? ` <span class="hint">${esc(cur.j.s)}</span>` : ''}</h3>
<p>${picked === 0 ? 'Your nearest junction' : 'Junction'}, ${fmtMiles(cur.d)} from ${esc(origin.name)} in a straight line.</p>
${list.length ? `<p><strong>${list.length} ${list.length === 1 ? 'playground' : 'playgrounds'}</strong> within about 5 minutes, nearest first:</p><ul class="facts">${items}</ul>` : `<p>We haven't found a ${free.checked ? 'free ' : ''}playground within about 5 minutes of this junction yet.</p>`}
</div>
${others ? `<h3 style="margin-top:16px;font-size:1.25rem">Other junctions near you</h3><ul class="facts">${others}</ul>` : ''}`;
  }

  out.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]');
    if (!b) return;
    picked = Number(b.dataset.pick);
    show();
    $('jf-best')?.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mine = ++lookup;
    hint.classList.remove('err');
    hint.textContent = 'Looking that up…';
    try {
      const o = await resolve(where.value, data.towns);
      if (mine !== lookup) return;
      if (!o) {
        hint.textContent = 'Enter a town or postcode first, or use Near me.';
        return;
      }
      origin = o;
      picked = 0;
      hint.textContent = `Showing junctions near ${o.name}.`;
      show();
    } catch (err) {
      if (mine !== lookup) return;
      hint.classList.add('err');
      hint.textContent = err instanceof Error && err.message.startsWith('We ') ? err.message : "We couldn't look that up just now. Check your connection and try again.";
    }
  });

  $('jf-locate').addEventListener('click', () => {
    if (!navigator.geolocation) {
      hint.textContent = "Your browser can't share your location. Enter a postcode instead.";
      return;
    }
    const mine = ++lookup;
    hint.classList.remove('err');
    hint.textContent = 'Finding you… your browser may ask for permission.';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (mine !== lookup) return;
        origin = { name: 'you', lat: pos.coords.latitude, lng: pos.coords.longitude };
        picked = 0;
        where.value = '';
        hint.textContent = 'Showing the junctions nearest to you.';
        show();
      },
      () => {
        if (mine !== lookup) return;
        hint.classList.add('err');
        hint.textContent = "We couldn't get your location. Enter a town or postcode instead.";
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 },
    );
  });

  // Free entry only: applies to the finder and to the lists by road, and is remembered.
  const applyLists = () => {
    document.querySelectorAll('.jrow').forEach((row) => {
      let shown = 0;
      row.querySelectorAll<HTMLLIElement>(':scope > ul > li').forEach((li) => {
        const ok = !(free.checked && li.hasAttribute('data-pay')) && shown < 3;
        li.hidden = !ok;
        if (ok) shown++;
      });
      const none = row.querySelector<HTMLElement>('.none');
      if (none) none.hidden = shown > 0;
    });
  };
  free.checked = store.get<boolean>('sb-free-only', false);
  free.addEventListener('change', () => {
    store.set('sb-free-only', free.checked);
    applyLists();
    show();
  });
  applyLists();
}

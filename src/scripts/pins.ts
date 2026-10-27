// "Is the pin in the wrong place?" under the playground map. A parent shows where the playground really is, by
// dragging a marker, tapping the map or using their phone's location. The pin only moves once two parents agree
// (see worker/pins.js and scripts/parent-pins.mjs).
import type { SpotMap } from './map';

type Summary = { agreed: { lat: number; lng: number; parents: number } | null; parents: number; mine: { lat: number; lng: number } | null };

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

export function startPins(ready: Promise<SpotMap | null>) {
  const box = document.getElementById('pin-fix');
  if (!box) return;
  const park = box.dataset.park!;
  const pin = { lat: Number(box.dataset.lat), lng: Number(box.dataset.lng) };
  const start = document.getElementById('pinfix-start') as HTMLButtonElement;
  const here = document.getElementById('pinfix-here') as HTMLButtonElement;
  const editing = document.getElementById('pinfix-editing')!;
  const send = document.getElementById('pinfix-send') as HTMLButtonElement;
  const cancel = document.getElementById('pinfix-cancel') as HTMLButtonElement;
  const withdraw = document.getElementById('pinfix-withdraw') as HTMLButtonElement;
  const msg = document.getElementById('pinfix-msg')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let view: SpotMap | null = null;
  let marker: InstanceType<SpotMap['Marker']> | null = null;
  let mine: Summary['mine'] = null;
  const onTap = (e: { lngLat: { lat: number; lng: number } }) => marker?.setLngLat([e.lngLat.lng, e.lngLat.lat]);

  function show(s: Summary) {
    mine = s.mine;
    withdraw.hidden = !mine;
    if (s.agreed && metres(pin, s.agreed) >= 30) msg.textContent = 'Parents agree the playground is somewhere else. We\'ll move the pin within a day or two.';
    else if (mine) msg.textContent = 'Thanks, we have your spot. The pin moves once another parent agrees. You can change it any time.';
  }

  function stop() {
    view?.map.off('click', onTap);
    marker?.remove();
    marker = null;
    editing.hidden = true;
    start.hidden = false;
    here.hidden = false;
  }

  function edit(at: { lat: number; lng: number }) {
    if (!view) {
      msg.textContent = "The map hasn't loaded, so you can't move the marker. Try “I'm at the playground now” instead.";
      return;
    }
    stop();
    const el = document.createElement('div');
    el.className = 'spot spot-suggest';
    el.innerHTML = '<span aria-hidden="true">✚</span>';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Your suggested position');
    marker = new view.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([at.lng, at.lat]).addTo(view.map);
    view.map.on('click', onTap);
    view.map.easeTo({ center: [at.lng, at.lat], zoom: Math.max(view.map.getZoom(), 17), duration: reduce ? 0 : 400 });
    editing.hidden = false;
    start.hidden = true;
    here.hidden = true;
    msg.textContent = 'Drag the blue marker onto the play area, or tap the map where it is, then send.';
    document.getElementById('park-map')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    send.focus({ preventScroll: true });
  }

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/pins', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ park, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again later.');
    return j as Summary;
  }

  ready.then((v) => (view = v));
  fetch(`/api/pins?park=${encodeURIComponent(park)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((s: Summary | null) => s && show(s))
    .catch(() => {});

  start.addEventListener('click', () => edit(mine ?? pin));
  cancel.addEventListener('click', () => {
    stop();
    msg.textContent = '';
    start.focus();
  });
  here.addEventListener('click', () => {
    if (!navigator.geolocation) {
      msg.textContent = "Your browser can't share your location. Move the marker on the map instead.";
      return;
    }
    msg.textContent = 'Finding where you are…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (p.coords.accuracy > 60) {
          msg.textContent = `Your phone only knows where you are to within ${Math.round(p.coords.accuracy)} metres, which isn't close enough. Move the marker on the map instead.`;
          edit(pin);
          return;
        }
        edit({ lat: p.coords.latitude, lng: p.coords.longitude });
        msg.textContent = "That's where your phone says you are. Nudge the marker onto the play area if it's not quite right, then send.";
      },
      () => {
        msg.textContent = "We couldn't get your location. Move the marker on the map instead.";
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
  send.addEventListener('click', async () => {
    if (!marker) return;
    const { lat, lng } = marker.getLngLat();
    send.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const s = await post({ lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 });
      stop();
      show(s);
      if (!(s.agreed && metres(pin, s.agreed) >= 30))
        msg.textContent = metres(pin, { lat, lng }) < 30 ? "Thanks. You've said the pin is in the right place." : 'Thanks! The pin moves once another parent agrees.';
      start.textContent = 'Change my spot';
      start.focus();
    } catch (e) {
      msg.textContent = (e as Error).message;
    } finally {
      send.disabled = false;
    }
  });
  withdraw.addEventListener('click', async () => {
    try {
      show(await post({ lat: null, lng: null }));
      msg.textContent = 'Your suggestion has been removed.';
      start.textContent = 'Show where it is';
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
  });
}

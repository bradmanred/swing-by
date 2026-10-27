import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre loads its worker as a separate file, so the bundler has to ship it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ClientPark } from '../lib/card';
import type { Bounds, MapView } from './finder';

// OpenFreeMap: free vector tiles from OpenStreetMap data, no API key needed.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function circle(lat: number, lng: number, metres: number) {
  const pts: [number, number][] = [];
  const dLat = metres / 111320;
  const dLng = metres / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [pts] } };
}

export function createMap(
  el: HTMLElement,
  onPick: (id: string) => void,
  onMove?: (centre: { lat: number; lng: number }, bounds: Bounds) => void,
): MapView | null {
  let map: maplibregl.Map;
  maplibregl.setWorkerUrl(workerUrl);
  try {
    el.innerHTML = '';
    map = new maplibregl.Map({ container: el, style: STYLE, center: [-0.336, 51.752], zoom: 12, cooperativeGestures: true });
  } catch {
    el.innerHTML = '<p class="nojs">Your browser can\'t show the map. The list of nearby parks still works.</p>';
    return null;
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Map. Use arrow keys to move and plus or minus to zoom.');

  const youEl = document.createElement('div');
  youEl.className = 'you';
  youEl.setAttribute('role', 'img');
  youEl.setAttribute('aria-label', 'You are here');
  const you = new maplibregl.Marker({ element: youEl });
  let pins: maplibregl.Marker[] = [];
  let pending: Parameters<MapView['update']> | null = null;
  let ready = false;

  // Search the new area when someone drags, zooms or uses the keyboard on the map. Moves the page makes itself
  // (fitting the map to new results) have no originalEvent, so they don't count.
  let userMove = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  map.on('movestart', (e) => {
    if ((e as { originalEvent?: Event }).originalEvent) userMove = true;
  });
  map.on('moveend', (e) => {
    if (!userMove && !(e as { originalEvent?: Event }).originalEvent) return;
    userMove = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const c = map.getCenter();
      const b = map.getBounds();
      onMove?.({ lat: c.lat, lng: c.lng }, { n: b.getNorth(), s: b.getSouth(), e: b.getEast(), w: b.getWest() });
    }, 350);
  });

  map.on('load', () => {
    map.addSource('acc', { type: 'geojson', data: circle(51.752, -0.336, 1) });
    map.addLayer({ id: 'acc-fill', type: 'fill', source: 'acc', paint: { 'fill-color': '#1A3FB8', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'acc-line', type: 'line', source: 'acc', paint: { 'line-color': '#1A3FB8', 'line-width': 2, 'line-dasharray': [3, 3] } });
    ready = true;
    if (pending) view.update(...pending);
  });

  const view: MapView = {
    update(o, top, opts = {}) {
      if (!ready) {
        pending = [o, top, opts];
        return;
      }
      (map.getSource('acc') as maplibregl.GeoJSONSource).setData(circle(o.lat, o.lng, Math.max(o.acc, 60)));
      you.setLngLat([o.lng, o.lat]).addTo(map);
      pins.forEach((p) => p.remove());
      pins = top.map((p, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pin';
        b.innerHTML = `<span aria-hidden="true">${i + 1}</span>${p.pay ? '<span class="pin-pay" aria-hidden="true">£</span>' : ''}`;
        b.setAttribute('aria-label', `${i + 1}: ${p.n}${p.pay ? ', paid entry' : ''}. Go to its card.`);
        b.addEventListener('click', () => onPick(p.id));
        return new maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
      });
      for (const p of opts.more ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pin-dot';
        if (p.pay) b.innerHTML = '<span class="pin-pay" aria-hidden="true">£</span>';
        b.setAttribute('aria-label', `${p.n}${p.pay ? ', paid entry' : ''}. Go to its card.`);
        b.title = p.pay ? `${p.n} (paid entry)` : p.n;
        b.addEventListener('click', () => onPick(p.id));
        pins.push(new maplibregl.Marker({ element: b, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map));
      }
      if (opts.fit === false) return;
      // The page is about to move the map itself: forget any half-finished drag so this move isn't taken for one.
      userMove = false;
      clearTimeout(timer);
      const bounds = new maplibregl.LngLatBounds([o.lng, o.lat], [o.lng, o.lat]);
      top.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
    },
  };
  return view;
}

export type Spot = { lat: number; lng: number; label: string; kind: 'park' | 'parking' | 'toilets' | 'cafe' | 'transport' | 'other' | 'nearby'; href?: string };

const BADGE: Record<Spot['kind'], string> = { park: '🛝', parking: 'P', toilets: 'WC', cafe: '☕', transport: '⇄', other: '★', nearby: '🛝' };

export type SpotMap = { map: maplibregl.Map; pin: maplibregl.Marker; Marker: typeof maplibregl.Marker };

/** A close-up map of one playground. The basemap already shows car parks, toilets and cafés from OpenStreetMap. */
export function createSpotMap(el: HTMLElement, spots: Spot[]): SpotMap | null {
  maplibregl.setWorkerUrl(workerUrl);
  let map: maplibregl.Map;
  try {
    el.innerHTML = '';
    map = new maplibregl.Map({ container: el, style: STYLE, center: [spots[0].lng, spots[0].lat], zoom: 16, cooperativeGestures: true });
  } catch {
    el.innerHTML = '<p class="nojs">Your browser can\'t show the map. Use the directions link instead.</p>';
    return null;
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Map. Use arrow keys to move and plus or minus to zoom.');
  const bounds = new maplibregl.LngLatBounds([spots[0].lng, spots[0].lat], [spots[0].lng, spots[0].lat]);
  let pin: maplibregl.Marker | null = null;
  spots.forEach((s, i) => {
    const node = document.createElement(s.href ? 'a' : 'div');
    node.className = `spot spot-${s.kind}`;
    node.innerHTML = `<span aria-hidden="true">${BADGE[s.kind]}</span>`;
    if (s.href) (node as HTMLAnchorElement).href = s.href;
    else node.setAttribute('role', 'img');
    node.setAttribute('aria-label', s.label);
    node.title = s.label;
    const marker = new maplibregl.Marker({ element: node, anchor: i === 0 ? 'bottom' : 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
    if (i === 0) pin = marker;
    if (s.kind !== 'nearby') bounds.extend([s.lng, s.lat]);
  });
  if (spots.some((s, i) => i > 0 && s.kind !== 'nearby')) map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 0 });
  return { map, pin: pin!, Marker: maplibregl.Marker };
}

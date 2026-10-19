import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre loads its worker as a separate file, so the bundler has to ship it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ClientPark } from '../lib/card';
import type { MapView } from './finder';

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

export function createMap(el: HTMLElement, onPick: (id: string) => void): MapView | null {
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

  map.on('load', () => {
    map.addSource('acc', { type: 'geojson', data: circle(51.752, -0.336, 1) });
    map.addLayer({ id: 'acc-fill', type: 'fill', source: 'acc', paint: { 'fill-color': '#1A3FB8', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'acc-line', type: 'line', source: 'acc', paint: { 'line-color': '#1A3FB8', 'line-width': 2, 'line-dasharray': [3, 3] } });
    ready = true;
    if (pending) view.update(...pending);
  });

  const view: MapView = {
    update(o, top) {
      if (!ready) {
        pending = [o, top];
        return;
      }
      (map.getSource('acc') as maplibregl.GeoJSONSource).setData(circle(o.lat, o.lng, Math.max(o.acc, 60)));
      you.setLngLat([o.lng, o.lat]).addTo(map);
      pins.forEach((p) => p.remove());
      pins = top.map((p, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pin';
        b.innerHTML = `<span aria-hidden="true">${i + 1}</span>`;
        b.setAttribute('aria-label', `${i + 1}: ${p.n}. Go to its card.`);
        b.addEventListener('click', () => onPick(p.id));
        return new maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
      });
      const bounds = new maplibregl.LngLatBounds([o.lng, o.lat], [o.lng, o.lat]);
      top.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
    },
  };
  return view;
}

export type Spot = { lat: number; lng: number; label: string; kind: 'park' | 'parking' | 'toilets' | 'cafe' | 'transport' | 'other' | 'nearby'; href?: string };

const BADGE: Record<Spot['kind'], string> = { park: '🛝', parking: 'P', toilets: 'WC', cafe: '☕', transport: '⇄', other: '★', nearby: '🛝' };

/** A close-up map of one playground. The basemap already shows car parks, toilets and cafés from OpenStreetMap. */
export function createSpotMap(el: HTMLElement, spots: Spot[]) {
  maplibregl.setWorkerUrl(workerUrl);
  let map: maplibregl.Map;
  try {
    el.innerHTML = '';
    map = new maplibregl.Map({ container: el, style: STYLE, center: [spots[0].lng, spots[0].lat], zoom: 16, cooperativeGestures: true });
  } catch {
    el.innerHTML = '<p class="nojs">Your browser can\'t show the map. Use the directions link instead.</p>';
    return;
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Map. Use arrow keys to move and plus or minus to zoom.');
  const bounds = new maplibregl.LngLatBounds([spots[0].lng, spots[0].lat], [spots[0].lng, spots[0].lat]);
  spots.forEach((s, i) => {
    const node = document.createElement(s.href ? 'a' : 'div');
    node.className = `spot spot-${s.kind}`;
    node.innerHTML = `<span aria-hidden="true">${BADGE[s.kind]}</span>`;
    if (s.href) (node as HTMLAnchorElement).href = s.href;
    else node.setAttribute('role', 'img');
    node.setAttribute('aria-label', s.label);
    node.title = s.label;
    new maplibregl.Marker({ element: node, anchor: i === 0 ? 'bottom' : 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
    if (s.kind !== 'nearby') bounds.extend([s.lng, s.lat]);
  });
  if (spots.some((s, i) => i > 0 && s.kind !== 'nearby')) map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 0 });
}

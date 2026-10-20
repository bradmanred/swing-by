// Card markup shared by the server-rendered list and the browser finder, so both look identical.
import labels from '../data/labels.json';

export type ClientPark = {
  id: string; n: string; a: string; r: string; lat: number; lng: number;
  ages: string[]; f: string[]; c: string | null; m: string | null; d: string;
};

const ICON: Record<string, string> = {
  sw: '🪢', bs: '👶', sl: '🛝', tp: '🤸', ss: '⚖️', mb: '🐒', cl: '🧗', zw: '🚡', sp: '🏖️', wp: '💦', ad: '🏴‍☠️', rb: '🎠', tr: '🚂', sk: '🛹',
  inc: '♿', sf: '♿', sen: '✋', wc: '🚻', bc: '🍼', cf: '☕', fen: '🚧', sh: '🌳', fp: '🅿️',
};
const NAMES: Record<string, string> = { ...labels.equipment, ...labels.access, ...labels.facilities };
const MEM = labels.memberships as Record<string, string>;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtMiles = (k: number) => {
  const mi = k * 0.621371;
  return mi < 0.1 ? 'Under 0.1 mi' : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
};

const fmtDate = (d: string) =>
  new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const SKIES = ['#BFE3FF', '#FFE7A3', '#D9F2C9', '#FFD9E0'];

export function art(p: ClientPark) {
  const sky = SKIES[[...p.id].reduce((s, c) => s + c.charCodeAt(0), 0) % SKIES.length];
  const ground = '<rect y="120" width="360" height="50" fill="#7BC96F"/>';
  let scene: string;
  if (p.f.includes('wp'))
    scene = '<rect y="120" width="360" height="50" fill="#5BA8E0"/><path d="M60 120 q10 -40 20 0 M140 120 q10 -60 20 0 M220 120 q10 -45 20 0 M300 120 q10 -55 20 0" stroke="#FFFFFF" stroke-width="6" fill="none"/>';
  else if (p.f.includes('zw'))
    scene = ground + '<path d="M40 120 V40 M320 120 V70 M40 45 L320 75" stroke="#1A1A2E" stroke-width="6" fill="none"/><circle cx="180" cy="72" r="12" fill="#D7263D" stroke="#1A1A2E" stroke-width="3"/>';
  else if (p.f.includes('sk'))
    scene = ground + '<path d="M40 120 Q100 120 120 60 M240 60 Q260 120 320 120" stroke="#1A3FB8" stroke-width="10" fill="none"/>';
  else
    scene = ground + '<path d="M40 120 L80 40 L120 120 M80 40 H200 M160 40 L200 120" stroke="#D7263D" stroke-width="8" fill="none"/><path d="M110 40 V95 M140 40 V95" stroke="#1A1A2E" stroke-width="3"/><rect x="104" y="95" width="42" height="8" rx="4" fill="#1A1A2E"/><path d="M240 120 V60 H300 V120 M240 60 L270 30 L300 60" fill="none" stroke="#1A1A2E" stroke-width="6"/><path d="M300 75 Q330 95 335 120" stroke="#FFD23F" stroke-width="10" fill="none"/>';
  return `<svg class="art" viewBox="0 0 360 170" aria-hidden="true" focusable="false"><rect width="360" height="170" fill="${sky}"/>${scene}</svg>`;
}

export type CardPhoto = { url: string; credit: string | null };

/** An approved parent photo if there is one, otherwise the illustration. */
const picture = (p: ClientPark, photo?: CardPhoto) =>
  photo ? `<img class="art" src="${esc(photo.url)}" alt="" loading="lazy" decoding="async" />` : art(p);

export function cardHTML(p: ClientPark, o: { dist?: number; num?: number; mine?: { v?: boolean; r?: number }; photo?: CardPhoto } = {}) {
  const chips = p.f
    .filter((k) => NAMES[k])
    .slice(0, 4)
    .map((k) => `<li><span aria-hidden="true">${ICON[k] ?? ''}</span> ${esc(NAMES[k])}</li>`);
  if (p.m) chips.push(`<li class="mem">${esc(MEM[p.m])}</li>`);
  if (o.mine?.r) chips.push(`<li class="rate">Your rating: ${o.mine.r} out of 5</li>`);
  const foot = p.c
    ? `✓ Checked ${fmtDate(p.c)}`
    : '<span class="chips"><span class="unv" style="padding:4px 12px;border-radius:10px">Unverified</span></span> Details not checked yet';
  return `<li class="card" id="card-${esc(p.id)}">${picture(p, o.photo)}<div class="body">
<h3>${o.num ? `<span class="sr-only">${o.num}. </span>` : ''}<a href="/playgrounds/${esc(p.id)}/">${esc(p.n)}</a></h3>
<p class="meta">${o.dist != null ? `<strong>${fmtMiles(o.dist)}</strong> · ` : ''}${esc(p.a)}${o.mine?.v ? ' · ✓ Been here' : ''}</p>
${chips.length ? `<ul class="chips" aria-label="Features">${chips.join('')}</ul>` : ''}
${p.d ? `<p>${esc(p.d)}${p.d.length >= 140 ? '…' : ''}</p>` : ''}
<p class="foot">${foot}</p></div></li>`;
}

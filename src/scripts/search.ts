// Site search: playgrounds by name, town, county, who runs them, equipment and description, plus the site's pages.
// Ticking a play area size narrows the results to graded playgrounds of that size (pages drop out), and with an
// empty search box lists every playground of that size.
// Runs in the browser over /search-index.json, which is built with the site.
import { esc } from '../lib/card';
import { track, searchTerm } from './track';

export type IndexPark = { id: string; n: string; a: string; r: string; o: string; f: string[]; m: string; d: string; c: boolean; s?: string | null };
export type IndexPage = { url: string; title: string; text: string };
export type Hit = { kind: 'park'; park: IndexPark; score: number } | { kind: 'page'; page: IndexPage; score: number };

/** Lower case, no accents or apostrophes, "&" as "and", single spaces. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Allow one slip in longer words, so "moneyhol" or "cassiobery" still find the park.
function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How well one search word matches one field: whole word, start of a word, inside a word, or a near miss. */
function wordScore(token: string, field: string) {
  if (!field) return 0;
  const words = field.split(' ');
  if (words.includes(token)) return 3;
  if (words.some((w) => w.startsWith(token))) return 2;
  if (token.length >= 4 && field.replace(/ /g, '').includes(token)) return 1.5; // "moneyhole" in "money hole", or the other way
  if (token.length >= 5 && words.some((w) => near(token, w))) return 1;
  return 0;
}

export function search(q: string, parks: IndexPark[], pages: IndexPage[]): Hit[] {
  const query = norm(q);
  if (!query) return [];
  const tokens = [...new Set(query.split(' '))].filter((t) => t.length > 1 || /\d/.test(t));
  if (!tokens.length) return [];
  const squashed = query.replace(/ /g, '');
  const hits: Hit[] = [];

  for (const park of parks) {
    const fields: [string, number][] = [
      [norm(park.n), 10],
      [norm(park.a), 6],
      [norm(park.r), 3],
      [norm(park.o), 3],
      [norm(park.f.join(' ') + ' ' + park.m), 2],
      [norm(park.d), 1],
    ];
    let score = 0;
    let all = true;
    for (const t of tokens) {
      let best = 0;
      for (const [text, weight] of fields) best = Math.max(best, wordScore(t, text) * weight);
      if (!best) {
        all = false;
        break;
      }
      score += best;
    }
    if (!all) continue;
    const name = norm(park.n);
    if (name === query) score += 50;
    else if (name.startsWith(query) || name.replace(/ /g, '').startsWith(squashed)) score += 25;
    hits.push({ kind: 'park', park, score });
  }

  for (const page of pages) {
    const title = norm(page.title);
    const text = norm(page.text);
    let score = 0;
    let all = true;
    for (const t of tokens) {
      const s = Math.max(wordScore(t, title) * 8, wordScore(t, text) * 2);
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ kind: 'page', page, score });
  }

  return hits.sort((a, b) => b.score - a.score || label(a).localeCompare(label(b), 'en-GB'));
}

/** Narrow the hits to the chosen sizes. With no search words, every playground of those sizes, A to Z. */
export function bySize(q: string, hits: Hit[], parks: IndexPark[], sizes: Set<string>): Hit[] {
  if (!sizes.size) return hits;
  if (!norm(q))
    return parks
      .filter((p) => p.s && sizes.has(p.s))
      .map((park): Hit => ({ kind: 'park', park, score: 0 }))
      .sort((a, b) => label(a).localeCompare(label(b), 'en-GB'));
  return hits.filter((h) => h.kind === 'park' && !!h.park.s && sizes.has(h.park.s));
}

const label = (h: Hit) => (h.kind === 'park' ? h.park.n : h.page.title);

export function hitHTML(h: Hit) {
  if (h.kind === 'page')
    return `<li class="hit"><a href="${esc(h.page.url)}">${esc(h.page.title)}</a><p class="meta">Page · ${esc(h.page.text)}</p></li>`;
  const p = h.park;
  const bits = [p.a, p.r, p.o && `Run by ${p.o}`].filter(Boolean).map(esc).join(' · ');
  const desc = p.d ? `<p>${esc(p.d.length > 160 ? p.d.slice(0, 157) + '…' : p.d)}</p>` : '';
  return `<li class="hit"><a href="/playgrounds/${esc(p.id)}/">${esc(p.n)}</a><p class="meta">${bits}${p.c ? '' : ' · Unverified'}</p>${desc}</li>`;
}

export function startSearch() {
  const form = document.getElementById('search-page-form') as HTMLFormElement;
  const input = document.getElementById('q') as HTMLInputElement;
  const out = document.getElementById('search-results')!;
  const status = document.getElementById('search-status')!;
  const more = document.getElementById('search-more') as HTMLButtonElement;
  const sizeBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name=size]')];
  const chosen = () => new Set(sizeBoxes.filter((c) => c.checked).map((c) => c.value));
  const readUrl = () => {
    const u = new URLSearchParams(location.search);
    input.value = u.get('q') ?? '';
    const want = new Set(u.getAll('size'));
    sizeBoxes.forEach((c) => (c.checked = want.has(c.value)));
  };
  let data: { parks: IndexPark[]; pages: IndexPage[] } | null = null;
  let hits: Hit[] = [];
  let shown = 20;

  const draw = () => {
    out.innerHTML = hits.slice(0, shown).map(hitHTML).join('');
    more.hidden = hits.length <= shown;
  };

  function run(q: string, push = false) {
    if (!data) return;
    const sizes = chosen();
    hits = bySize(q, search(q, data.parks, data.pages), data.parks, sizes);
    shown = 20;
    draw();
    const trimmed = q.trim();
    const sized = sizes.size ? ` (${['small', 'medium', 'large'].filter((k) => sizes.has(k)).join(' or ')} only)` : '';
    status.textContent =
      !trimmed && !sizes.size
        ? 'Type a playground name, town, county or what you\'re looking for, such as "zip wire".'
        : !trimmed
          ? `${hits.length} playground${hits.length === 1 ? '' : 's'}${sized}.`
          : hits.length
            ? `${hits.length} result${hits.length === 1 ? '' : 's'} for "${trimmed}"${sized}.`
            : `Nothing found for "${trimmed}"${sized}. Try a town name, check the spelling, or untick a size.`;
    const url = new URL(location.href);
    if (trimmed) url.searchParams.set('q', trimmed);
    else url.searchParams.delete('q');
    url.searchParams.delete('size');
    sizes.forEach((z) => url.searchParams.append('size', z));
    history[push ? 'pushState' : 'replaceState'](null, '', url);
    document.title = trimmed ? `Search: ${trimmed} | Swing By` : 'Advanced search | Swing By';
  }

  // Tell Analytics what was searched for (after consent only, see track.ts). Results appear as you type, so a search
  // counts when it is submitted or when typing pauses, never for each letter, and the same term isn't counted twice in a row.
  let reported = '';
  const report = (q: string) => {
    const term = searchTerm(q);
    if (!data || term.length < 2 || term === reported) return;
    reported = term;
    track('advanced_search', { search_term: term, results_count: hits.length });
  };

  let t: ReturnType<typeof setTimeout> | undefined;
  let r: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    clearTimeout(r);
    t = setTimeout(() => run(input.value), 150);
    r = setTimeout(() => report(input.value), 1500);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(r);
    run(input.value, true);
    report(input.value);
  });
  sizeBoxes.forEach((c) => c.addEventListener('change', () => run(input.value)));
  more.addEventListener('click', () => {
    const before = shown;
    shown += 20;
    draw();
    out.querySelectorAll<HTMLAnchorElement>('.hit > a')[before]?.focus();
  });
  window.addEventListener('popstate', () => {
    readUrl();
    run(input.value);
  });

  status.textContent = 'Loading…';
  fetch('/search-index.json')
    .then((r) => r.json())
    .then((d) => {
      data = d;
      const typed = input.value;
      readUrl();
      if (!input.value) input.value = typed;
      run(input.value);
    })
    .catch(() => {
      status.textContent = "Search couldn't load. Try the A to Z list of playgrounds instead.";
    });
}

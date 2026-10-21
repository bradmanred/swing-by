// Site search: playgrounds by name, town, county, who runs them, equipment and description, plus the site's pages.
// Runs in the browser over /search-index.json, which is built with the site.
import { esc } from '../lib/card';

export type IndexPark = { id: string; n: string; a: string; r: string; o: string; f: string[]; m: string; d: string; c: boolean };
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
  let data: { parks: IndexPark[]; pages: IndexPage[] } | null = null;
  let hits: Hit[] = [];
  let shown = 20;

  const draw = () => {
    out.innerHTML = hits.slice(0, shown).map(hitHTML).join('');
    more.hidden = hits.length <= shown;
  };

  function run(q: string, push = false) {
    if (!data) return;
    hits = search(q, data.parks, data.pages);
    shown = 20;
    draw();
    const trimmed = q.trim();
    status.textContent = !trimmed
      ? 'Type a playground name, town, county or what you\'re looking for, such as "zip wire".'
      : hits.length
        ? `${hits.length} result${hits.length === 1 ? '' : 's'} for "${trimmed}".`
        : `Nothing found for "${trimmed}". Try a town name, or check the spelling.`;
    const url = new URL(location.href);
    if (trimmed) url.searchParams.set('q', trimmed);
    else url.searchParams.delete('q');
    history[push ? 'pushState' : 'replaceState'](null, '', url);
    document.title = trimmed ? `Search: ${trimmed} | Swing By` : 'Search | Swing By';
  }

  let t: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => run(input.value), 150);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value, true);
  });
  more.addEventListener('click', () => {
    const before = shown;
    shown += 20;
    draw();
    out.querySelectorAll<HTMLAnchorElement>('.hit > a')[before]?.focus();
  });
  window.addEventListener('popstate', () => {
    input.value = new URLSearchParams(location.search).get('q') ?? '';
    run(input.value);
  });

  status.textContent = 'Loading…';
  fetch('/search-index.json')
    .then((r) => r.json())
    .then((d) => {
      data = d;
      input.value = new URLSearchParams(location.search).get('q') ?? input.value;
      run(input.value);
    })
    .catch(() => {
      status.textContent = "Search couldn't load. Try the A to Z list of playgrounds instead.";
    });
}

// A random playground photo in the blue space beside the search form, as decoration only.
// It only shows when the hero is in two columns (wide tablets and desktops) and the left-hand column has room left
// under the heading. It never makes the hero taller, so the search form and its buttons stay exactly where they were.

export type HeroPhoto = { id: string; name: string; src: string; credit: string };

const WIDE = '(min-width: 900px)';
const MIN_HEIGHT = 160; // px: any smaller and the photo is a sliver, so leave the blue space plain

export function startHeroPhoto(pool: HeroPhoto[]) {
  const fig = document.getElementById('hero-photo');
  const img = fig?.querySelector('img');
  const link = fig?.querySelector('a');
  const credit = fig?.querySelector<HTMLElement>('.hero-photo-credit');
  if (!fig || !img || !link || !credit || !pool.length) return;

  const wide = matchMedia(WIDE);
  let chosen: HeroPhoto | null = null;
  let broken = false;

  // Hide (but keep in the layout, so it can be measured) when the space left is too small.
  const fit = () => {
    fig.classList.toggle('is-cramped', fig.getBoundingClientRect().height < MIN_HEIGHT);
  };

  const show = () => {
    if (!wide.matches || broken) return;
    if (!chosen) {
      chosen = pool[Math.floor(Math.random() * pool.length)];
      link.href = `/playgrounds/${encodeURIComponent(chosen.id)}/`;
      link.textContent = chosen.name;
      credit.textContent = chosen.credit ? ` · Photo: ${chosen.credit}` : '';
      // Only download the image on screens that will show it.
      img.src = chosen.src;
    }
    fig.hidden = false;
    fit();
  };

  // A broken image would leave an empty box, so give the space back to the blue.
  img.addEventListener('error', () => { broken = true; fig.hidden = true; }, { once: true });
  img.addEventListener('load', () => fig.classList.add('is-loaded'), { once: true });
  new ResizeObserver(fit).observe(fig);
  wide.addEventListener('change', show);
  show();
}

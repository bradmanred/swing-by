// Playgrounds taken off in November 2026 because OpenStreetMap puts them inside school grounds
// (src/data/school-grounds.json). Their old addresses show a short page asking parents whether the playground is open
// to everyone, using the same "Is this a public playground?" answers as every playground page (worker/equipment.js).
// Once two parents from different households say it is, and more say so than not, the daily "Move pins parents agree
// on" workflow puts it back (scripts/school-grounds.mjs --parents). An official source brings it back too.
import data from '../src/data/school-grounds.json' with { type: 'json' };

/** Old page address → its entry ({ name, area, region, lat, lng }), for those still waiting. */
export const SCHOOL_PAGES = new Map(Object.entries(data.playgrounds).map(([osm, r]) => [r.page, { ...r, osm }]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The page for one of them. 404, so search engines drop the old listing, but people still see the question. */
export function schoolGroundsPage(page) {
  const p = SCHOOL_PAGES.get(page);
  const map = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(p.name)}, ${esc(p.area)} – is it open to everyone? | Swing By</title>
<style>
  body { font: 17px/1.5 system-ui, sans-serif; color: #1d2b36; background: #fbf8f2; margin: 0; }
  main { max-width: 36rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
  a { color: #0b5f8a; }
  .buttons { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1.25rem 0; }
  button { font: inherit; padding: .7rem 1.2rem; border-radius: .6rem; border: 2px solid #0b5f8a; background: #fff; color: #0b5f8a; cursor: pointer; }
  button[aria-pressed="true"] { background: #0b5f8a; color: #fff; }
  #status { min-height: 1.5em; }
</style>
</head>
<body>
<main>
  <p><a href="/">Swing By</a></p>
  <h1>${esc(p.name)}, ${esc(p.area)}</h1>
  <p>We've taken this playground off Swing By for now. <a href="${map}">On the map</a> it's inside school grounds, and school playgrounds usually aren't open to everyone.</p>
  <h2>Is it a public playground anyone can use?</h2>
  <p>If you know it, tell us. Once two parents agree it's open to everyone, it goes back on the site.</p>
  <div class="buttons">
    <button type="button" data-open="true" aria-pressed="false">Yes, anyone can use it</button>
    <button type="button" data-open="false" aria-pressed="false">No, it's the school's</button>
  </div>
  <p id="status" role="status"></p>
  <p><a href="/">Find another playground nearby</a></p>
</main>
<script>
  const park = ${JSON.stringify(page)};
  const status = document.getElementById('status');
  const buttons = [...document.querySelectorAll('[data-open]')];
  const show = (mine) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(mine === (b.dataset.open === 'true'))));
  fetch('/api/equipment?park=' + park).then((r) => r.json()).then((d) => show(d.mine ? d.mine.open : null)).catch(() => {});
  for (const b of buttons)
    b.addEventListener('click', async () => {
      const open = b.dataset.open === 'true';
      status.textContent = 'Saving…';
      try {
        const r = await fetch('/api/equipment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ park, items: [], open }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Something went wrong.');
        show(open);
        status.textContent = d.open === true ? 'Thank you! Parents agree it\\'s open to everyone, so it will be back on Swing By within a day or so.' : 'Thank you, we\\'ve saved your answer.';
      } catch (e) {
        status.textContent = e.message;
      }
    });
</script>
</body>
</html>
`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' } });
}

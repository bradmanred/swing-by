// "Where should we go next?" vote on the home page. Talks to /api/vote (worker/vote.js).
// Without JavaScript the form still posts to /api/vote and comes back to the home page.
type Results = { total: number; counts: Record<string, number>; mine: string | null };

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function startVote() {
  const form = $<HTMLFormElement>('#vote');
  if (!form) return;
  const msg = $('#vote-msg');
  const box = $('#vote-results');
  const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const radios = [...form.querySelectorAll<HTMLInputElement>('input[name=area]')];
  const names = Object.fromEntries(radios.map((r) => [r.value, r.parentElement!.textContent!.trim()]));

  function show(res: Results) {
    const rows = Object.entries(res.counts).sort((a, b) => b[1] - a[1] || names[a[0]].localeCompare(names[b[0]]));
    const top = Math.max(1, ...rows.map(([, n]) => n));
    $('#vote-summary').textContent =
      `${res.total} ${res.total === 1 ? 'family has' : 'families have'} voted so far.` + (res.mine ? ` You voted for ${names[res.mine]}.` : '');
    $('#vote-bars').innerHTML = rows
      .map(([id, n]) => {
        const pct = res.total ? Math.round((n / res.total) * 100) : 0;
        const you = id === res.mine ? ' <span class="mine">Your vote</span>' : '';
        return `<li><span class="lbl">${esc(names[id])}${you}</span><span class="n">${n} ${n === 1 ? 'vote' : 'votes'} (${pct}%)</span><span class="bar" aria-hidden="true"><span style="width:${(n / top) * 100}%"></span></span></li>`;
      })
      .join('');
    form.hidden = true;
    box.hidden = false;
  }

  // Already voted (this browser has the vote cookie)? Go straight to the results.
  fetch('/api/vote', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((res: Results | null) => {
      if (res?.mine) show(res);
      else if (new URLSearchParams(location.search).get('voted') && res) show(res);
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const area = radios.find((r) => r.checked)?.value;
    msg.classList.remove('err');
    if (!area) {
      msg.textContent = 'Pick an area first.';
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Sending your vote…';
    try {
      const r = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ area }),
      });
      if (!r.ok || !r.headers.get('Content-Type')?.includes('json')) throw new Error();
      msg.textContent = '';
      show(await r.json());
      $('#vote-summary').focus();
    } catch {
      msg.classList.add('err');
      msg.textContent = "We couldn't record your vote just now. Please try again later.";
    } finally {
      btn.disabled = false;
    }
  });

  $('#vote-change').addEventListener('click', () => {
    box.hidden = true;
    form.hidden = false;
    radios[0]?.focus();
  });
}

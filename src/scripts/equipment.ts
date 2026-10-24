// Parents tell us what a playground has. Answers only show once two parents agree (see worker/equipment.js).
import { esc } from '../lib/card';

type Summary = { confirmed: string[]; open: boolean | null; parents: number; mine: { items: string[]; open: boolean | null } };

export function startEquipment() {
  const box = document.getElementById('parent-eq');
  if (!box) return;
  const park = box.dataset.park!;
  const official = new Set<string>(JSON.parse(box.dataset.official || '[]'));
  const names = JSON.parse(box.dataset.names || '{}') as Record<string, [string, string]>;
  const form = document.getElementById('peq-form') as HTMLFormElement;
  const msg = document.getElementById('peq-msg')!;
  const shown = document.getElementById('peq-confirmed')!;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;

  function render(s: Summary) {
    const extra = s.confirmed.filter((k) => !official.has(k) && names[k]);
    const parts: string[] = [];
    if (s.open === true) parts.push('<p><strong>Parents confirm there\'s a playground here that anyone can use.</strong></p>');
    if (s.open === false) parts.push("<p class=\"warn\"><strong>Parents say there's no public playground here any more.</strong> Check before you go.</p>");
    if (extra.length)
      parts.push(
        `<p><strong>Parents confirm it also has:</strong></p><ul class="chips" style="margin-top:6px" aria-label="Confirmed by parents">${extra
          .map((k) => `<li><span aria-hidden="true">${esc(names[k][1])}</span> ${esc(names[k][0])}</li>`)
          .join('')}</ul>`,
      );
    shown.innerHTML = parts.join('');
    shown.hidden = !parts.length;
    // Show what this browser sent before, so a parent can change their answers.
    form.querySelectorAll<HTMLInputElement>('input[name=item]').forEach((i) => (i.checked = s.mine.items.includes(i.value)));
    const o = s.mine.open === true ? 'yes' : s.mine.open === false ? 'no' : '';
    const r = form.querySelector<HTMLInputElement>(`input[name=open][value="${o}"]`);
    if (r) r.checked = true;
    if (s.mine.items.length || s.mine.open != null) {
      button.textContent = 'Update what I saw';
      msg.textContent = 'Thanks for telling us. Your answers show once another parent agrees.';
    }
  }

  fetch(`/api/equipment?park=${encodeURIComponent(park)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
    .then((s: Summary | null) => s && render(s))
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = [...form.querySelectorAll<HTMLInputElement>('input[name=item]:checked')].map((i) => i.value);
    const o = form.querySelector<HTMLInputElement>('input[name=open]:checked')?.value ?? '';
    if (!items.length && !o) {
      msg.textContent = 'Tick what you saw, or say whether there\'s a playground here, then send.';
      return;
    }
    button.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/equipment', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ park, items, open: o === 'yes' ? true : o === 'no' ? false : null }),
      });
      const res = r.headers.get('Content-Type')?.includes('json') ? await r.json() : null;
      if (!r.ok || !res) throw new Error(res?.error ?? '');
      render(res);
      msg.textContent = res.parents > 1 ? 'Thanks! Anything another parent has also ticked now shows above.' : "Thanks! Your answers will show here once another parent agrees.";
    } catch (err) {
      msg.textContent = err instanceof Error && err.message ? err.message : "We couldn't send that just now. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });
}

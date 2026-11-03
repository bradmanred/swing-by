// "How could we make Swing By better?" on the home page. Sends to /api/feedback (worker/feedback.js).
// Without JavaScript the form still posts there and comes back to the home page with ?thanks=1.
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

export function startFeedback() {
  const form = $<HTMLFormElement>('#feedback');
  if (!form) return;
  const msg = $('#feedback-msg');
  const text = $<HTMLTextAreaElement>('#feedback-text');
  const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const thanks = () => {
    form.hidden = true;
    const done = $('#feedback-thanks');
    done.hidden = false;
    done.focus();
  };
  if (new URLSearchParams(location.search).get('thanks')) thanks();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.classList.remove('err');
    const message = text.value.trim();
    if (message.length < 3) {
      msg.classList.add('err');
      msg.textContent = 'Tell us your idea first.';
      text.focus();
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const website = (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message, website }),
      });
      const body = r.headers.get('Content-Type')?.includes('json') ? await r.json() : null;
      if (!r.ok || !body?.ok) throw new Error(body?.error);
      msg.textContent = '';
      thanks();
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = (err as Error).message || "Sorry, that didn't send. Please try again in a moment.";
      btn.disabled = false;
    }
  });
}

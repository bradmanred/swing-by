// Parent photos on a playground page: show approved photos, and let parents share one.
// Talks to /api/photos (worker/photos.js). If that isn't available, the illustration simply stays.
import { esc } from '../lib/card';

type Photo = { id: string; url: string; credit: string | null; added: string };

const MAX_SIDE = 1600;

// Redraw the photo at a sensible size. Re-encoding also drops hidden details such as the GPS location.
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale);
  const height = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  for (const q of [0.85, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size < 1_400_000) return { blob, width, height };
  }
  throw new Error('too big');
}

export function startPhotos() {
  const box = document.getElementById('photo-box');
  const form = document.getElementById('photo-form') as HTMLFormElement | null;
  if (!box || !form) return;
  const park = form.dataset.park!;
  const name = form.dataset.name!;
  const msg = document.getElementById('photo-msg')!;
  const btn = form.querySelector<HTMLButtonElement>('[type=submit]')!;

  // Show the newest approved photo in place of the illustration (unless the playground already has a curated photo).
  if (!box.dataset.curated) {
    fetch(`/api/photos?park=${encodeURIComponent(park)}`)
      .then((r) => (r.ok && r.headers.get('Content-Type')?.includes('json') ? r.json() : null))
      .then((res: { photos: Photo[] } | null) => {
        const p = res?.photos?.[0];
        if (!p) return;
        box.innerHTML = `<figure style="margin:0"><img src="${esc(p.url)}" alt="${esc(`Photo of ${name}, shared by a parent`)}" style="display:block;width:100%;height:auto" loading="lazy" />
<figcaption class="hint photo-cap">Photo shared by ${esc(p.credit || 'a Swing By parent')}, CC BY 4.0. <button type="button" class="linkbtn" data-report="${esc(p.id)}">Report this photo</button></figcaption></figure>`;
        box.querySelector<HTMLButtonElement>('[data-report]')?.addEventListener('click', async (e) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          try {
            const r = await fetch(`/api/photos/${encodeURIComponent(p.id)}/report`, { method: 'POST' });
            if (!r.ok) throw new Error();
            b.replaceWith("Thanks. We've hidden this photo until we've checked it.");
            box.querySelector('img')?.remove();
          } catch {
            b.disabled = false;
            b.textContent = "Couldn't send. Try again";
          }
        });
      })
      .catch(() => {});
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.classList.remove('err');
    const file = (form.elements.namedItem('photo') as HTMLInputElement).files?.[0];
    const fail = (t: string) => {
      msg.classList.add('err');
      msg.textContent = t;
    };
    if (!file) return fail('Choose a photo first.');
    if (!(form.elements.namedItem('no_people') as HTMLInputElement).checked || !(form.elements.namedItem('own_photo') as HTMLInputElement).checked)
      return fail('Please tick both boxes to confirm there are no people in the photo and that you took it.');
    btn.disabled = true;
    msg.textContent = 'Getting your photo ready…';
    try {
      let shrunk;
      try {
        shrunk = await shrink(file);
      } catch {
        return fail("We couldn't read that photo. Try a JPEG or PNG.");
      }
      const data = new FormData();
      data.set('park', park);
      data.set('photo', shrunk.blob, 'photo.jpg');
      data.set('width', String(shrunk.width));
      data.set('height', String(shrunk.height));
      data.set('credit', (form.elements.namedItem('credit') as HTMLInputElement).value);
      data.set('no_people', 'yes');
      data.set('own_photo', 'yes');
      msg.textContent = 'Sending…';
      const r = await fetch('/api/photos', { method: 'POST', body: data });
      const res = r.headers.get('Content-Type')?.includes('json') ? await r.json() : null;
      if (!r.ok) return fail(res?.error ?? "We couldn't take photos just now. Please try again later.");
      form.reset();
      msg.textContent = res?.message ?? "Thanks! We'll check your photo, and it will appear here once it's approved.";
    } catch {
      fail("We couldn't send your photo. Check your connection and try again.");
    } finally {
      btn.disabled = false;
    }
  });
}

// Cloudflare Pages Function: finishes GitHub sign-in and hands the token to Decap CMS in the opener window.
const page = (status, payload) => {
  const msg = JSON.stringify(`authorization:github:${status}:${JSON.stringify(payload)}`).replace(/</g, '\\u003c');
  return new Response(
    `<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>Signing in</title><p>Signing you in…</p><script>
(function () {
  function receive(e) {
    if (e.origin !== location.origin) return;
    window.opener.postMessage(${msg}, e.origin);
    window.removeEventListener('message', receive);
  }
  window.addEventListener('message', receive);
  window.opener.postMessage('authorizing:github', location.origin);
})();
</script></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'sb_oauth_state=; Path=/api; Max-Age=0' } },
  );
};

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = /(?:^|;\s*)sb_oauth_state=([^;]+)/.exec(request.headers.get('Cookie') || '')?.[1];
  if (!code || !state || state !== cookie) return page('error', { message: 'Sign-in expired. Close this window and try again.' });
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
  });
  const data = await res.json();
  if (!data.access_token) return page('error', { message: data.error_description || 'GitHub sign-in failed.' });
  return page('success', { token: data.access_token, provider: 'github' });
}

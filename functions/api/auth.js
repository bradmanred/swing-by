// Cloudflare Pages Function: starts GitHub sign-in for Decap CMS.
// Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set in the Pages project's settings.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/callback`);
  auth.searchParams.set('scope', 'repo');
  auth.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': `sb_oauth_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

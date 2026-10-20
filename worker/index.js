// Cloudflare Worker: GitHub sign-in for Decap CMS at /api/auth and /api/callback, the next-area vote at /api/vote;
// everything else is the static site.
// Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set as variables and secrets on the Worker, and the VOTES D1 binding.
import { onRequest as auth } from '../functions/api/auth.js';
import { onRequest as callback } from '../functions/api/callback.js';
import { vote } from './vote.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/auth') return auth({ request, env });
    if (pathname === '/api/callback') return callback({ request, env });
    if (pathname === '/api/vote') return vote({ request, env });
    return env.ASSETS.fetch(request);
  },
};

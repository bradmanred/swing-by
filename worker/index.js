// Cloudflare Worker: GitHub sign-in for Decap CMS at /api/auth and /api/callback, the next-area vote at /api/vote,
// parent photos at /api/photos; everything else is the static site. Also redirects www to the bare domain.
// Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set as variables and secrets on the Worker, the VOTES and PHOTOS_DB
// D1 bindings, and a MOD_TOKEN secret for approving photos.
import { onRequest as auth } from '../functions/api/auth.js';
import { onRequest as callback } from '../functions/api/callback.js';
import { vote } from './vote.js';
import { photos } from './photos.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    // One address for the site: send www.swing-by.co.uk to swing-by.co.uk, keeping the path.
    if (url.hostname === 'www.swing-by.co.uk') {
      url.hostname = 'swing-by.co.uk';
      return Response.redirect(url.toString(), 301);
    }
    if (pathname === '/api/auth') return auth({ request, env });
    if (pathname === '/api/callback') return callback({ request, env });
    if (pathname === '/api/vote' || pathname === '/api/vote/suggestions') return vote({ request, env, pathname });
    if (pathname === '/api/photos' || pathname.startsWith('/api/photos/')) return photos({ request, env, pathname });
    return env.ASSETS.fetch(request);
  },
};

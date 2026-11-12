// A tiny static server for the built site in dist/, shared by the browser tests (tests/a11y.mjs and
// tests/a11y-full.mjs). Serves packed playground pages the way the Worker does (worker/packs.js). Returns the server and its base address; close it with server.close().
import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PACK_DIR, cutPage, packFor, packIds, packPath, pageId } from '../worker/packs.js';

/** A packed playground page's HTML (a Buffer) from the build, or null. See worker/packs.js. */
export async function readPacked(id, dist = 'dist') {
  const bytes = await readFile(join(dist, packPath(packFor(id)))).catch(() => null);
  const page = bytes && cutPage(new Uint8Array(bytes), id);
  return page ? Buffer.from(page.body) : null;
}

/** Every packed playground id in the build. */
export async function packedIds(dist = 'dist') {
  const files = await readdir(join(dist, PACK_DIR)).catch(() => []);
  const ids = [];
  for (const f of files) if (f.endsWith('.pack')) ids.push(...packIds(new Uint8Array(await readFile(join(dist, PACK_DIR, f)))));
  return ids;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.yml': 'text/yaml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

export async function serve(port) {
  const base = `http://localhost:${port}`;
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, base).pathname);
    const id = pageId(path);
    const packed = id && (await readPacked(id));
    if (packed) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(packed);
    }
    let file = join('dist', normalize(path));
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(await readFile('dist/404.html'));
    }
  });
  await new Promise((ok) => server.listen(port, ok));
  return { server, base };
}

/** The axe rules every browser test checks against. */
export const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// A tiny static server for the built site in dist/, shared by the browser tests (tests/a11y.mjs and
// tests/a11y-full.mjs). Returns the server and its base address; close it with server.close().
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.yml': 'text/yaml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

export async function serve(port) {
  const base = `http://localhost:${port}`;
  const server = createServer(async (req, res) => {
    let file = join('dist', normalize(decodeURIComponent(new URL(req.url, base).pathname)));
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

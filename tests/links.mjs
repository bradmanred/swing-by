// Checks scripts/link-status.mjs against a local web server, so no real site is touched. A page that answers HEAD
// with 404 but loads with GET must count as working. Run by `npm test`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { linkStatus } from '../scripts/link-status.mjs';

const server = createServer((req, res) => {
  const routes = {
    '/ok': [200, 200],
    '/head-404': [404, 200], // like the East Herts, Amber Valley and Bedford pages in the 2026-11-01 report
    '/head-405': [405, 200],
    '/gone': [404, 404],
    '/removed': [410, 410],
  };
  const [head, get] = routes[req.url] ?? [404, 404];
  res.writeHead(req.method === 'HEAD' ? head : get);
  res.end(req.method === 'HEAD' ? undefined : 'page');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal(await linkStatus(`${base}/ok`), 200);
  assert.equal(await linkStatus(`${base}/head-404`), 200, 'a 404 answer to HEAD must be confirmed with GET');
  assert.equal(await linkStatus(`${base}/head-405`), 200);
  assert.equal(await linkStatus(`${base}/gone`), 404);
  assert.equal(await linkStatus(`${base}/removed`), 410);
  assert.equal(await linkStatus('http://127.0.0.1:1/nothing', { timeout: 2000 }), 0);
  console.log('links: ok');
} finally {
  server.close();
}

// Works out whether an official source link still works, for scripts/quarterly-check.mjs. Tries a HEAD request first
// (cheap), then GET. A "not found" (404 or 410) answer to HEAD is always confirmed with GET before it's believed:
// some council sites (East Herts, Amber Valley, Bedford) answer HEAD with 404 for pages that load fine, which made
// the first quarterly report flag working links as broken. Returns the HTTP status, or 0 if the site couldn't be
// reached.
export async function linkStatus(url, { headers = {}, timeout = 20000 } = {}) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method, headers, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
      if (method === 'HEAD' && [403, 404, 405, 410, 501].includes(r.status)) continue; // check with GET
      return r.status;
    } catch {
      if (method === 'GET') return 0;
    }
  }
  return 0;
}

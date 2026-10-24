# Targeted council crawl: for each council, start at its play/park directory and follow only links matching its pattern.
# Saves raw HTML (for map coordinates) to tmp/crawl3/<tag>/.
import os, re, json, hashlib, urllib.request, urllib.parse, time, sys
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept-Language": "en-GB"}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
            return r.read(), r.geturl(), r.status
    except Exception as e:
        return None, str(e)[:150], None
cfg = json.load(open("tmp/councils.json"))
for c in cfg:
    tag, seeds, pat, maxn = c["tag"], c["seeds"], re.compile(c["follow"]), c.get("max", 400)
    d = f"tmp/crawl6/{tag}"; os.makedirs(d, exist_ok=True)
    seen, queue, idx = set(), list(seeds), []
    while queue and len(seen) < maxn:
        u = queue.pop(0)
        if u in seen: continue
        seen.add(u)
        b, final, st = get(u)
        if b is None:
            idx.append({"url": u, "err": final}); continue
        f = hashlib.md5(u.encode()).hexdigest()[:10] + ".html"
        open(f"{d}/{f}", "wb").write(b)
        idx.append({"url": u, "final": final, "file": f})
        for href in re.findall(r'href="([^"#]+)"', b.decode("utf-8", "ignore")):
            full = urllib.parse.urljoin(final, href.replace("&amp;", "&"))
            if pat.search(full) and full not in seen and full not in queue: queue.append(full)
        time.sleep(0.3)
    json.dump(idx, open(f"{d}/index.json", "w"), indent=0)
    print(tag, len(idx), sum(1 for i in idx if "err" in i))

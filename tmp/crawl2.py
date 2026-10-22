import os, re, json, hashlib, urllib.request, urllib.parse, time, subprocess
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
os.makedirs("tmp/crawl2", exist_ok=True)
PAT = re.compile(r"(play|park|recreation|rec-ground|open-space|openspace|green-space|playing-field|amenit|facilit|services|leisure)", re.I)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
            return r.read(), r.geturl()
    except Exception as e:
        return None, str(e)[:150]
def text(b):
    if b[:4] == b"%PDF":
        open("/tmp/x.pdf", "wb").write(b)
        try: return subprocess.run(["pdftotext", "-layout", "/tmp/x.pdf", "-"], capture_output=True, timeout=60).stdout.decode("utf-8", "ignore")
        except Exception: return ""
    s = b.decode("utf-8", "ignore")
    s = re.sub(r"(?s)<(script|style|nav|header|footer)[^>]*>.*?</\1>", " ", s)
    import html
    return re.sub(r"[ \t]+", " ", html.unescape(re.sub(r"<(br|p|li|tr|h\d|div)[^>]*>", "\n", re.sub(r"</?(?!br|p|li|tr|h\d|div)[a-z][^>]*>", " ", s, flags=re.I), flags=re.I)))
out = []
for line in open("tmp/seeds.txt"):
    line = line.strip()
    if not line or line.startswith("#"): continue
    tag, seeds = line.split(" ", 1); seeds = seeds.split()
    host = urllib.parse.urlparse(seeds[0]).netloc
    seen, queue, n = set(), list(seeds), 0
    while queue and n < 30:
        u = queue.pop(0)
        if u in seen: continue
        seen.add(u); n += 1
        b, final = get(u)
        rec = {"tag": tag, "url": u}
        if b is None:
            rec["err"] = final; out.append(rec); continue
        t = text(b)
        f = f"{tag}-{hashlib.md5(u.encode()).hexdigest()[:8]}.txt"
        open("tmp/crawl2/" + f, "w").write(u + "\n\n" + re.sub(r"\n\s*\n+", "\n", t))
        rec["file"] = f; rec["play"] = len(re.findall(r"(?i)play ?(area|ground|park)", t)); out.append(rec)
        if b[:4] != b"%PDF" and (u in seeds or PAT.search(u)):
            for href in re.findall(r'href="([^"#]+)"', b.decode("utf-8", "ignore")):
                full = urllib.parse.urljoin(final, href.replace("&amp;", "&"))
                p = urllib.parse.urlparse(full)
                if p.netloc == host and PAT.search(p.path) and full not in seen and not re.search(r"\.(jpg|jpeg|png|gif|svg|css|js|docx?|xlsx?)$", full, re.I):
                    queue.append(full)
        time.sleep(0.4)
json.dump(out, open("tmp/crawl2/index.json", "w"), indent=1)

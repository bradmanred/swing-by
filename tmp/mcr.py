import re, json, html, urllib.request, urllib.parse, time
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
B = "https://www.manchester.gov.uk"
base = "/online-directories/parks-leisure-and-the-arts-directories/parks-playgrounds-allotments-and-open-spaces-directories/parks-and-open-spaces/all-parks-playgrounds-and-open-spaces"
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r: return r.read().decode("utf-8", "ignore")
links = []
for p in range(1, 12):
    h = get(B + base + (f"?page={p}" if p > 1 else ""))
    m = [urllib.parse.urljoin(B, x.split("?")[0]) for x in re.findall(r'href="([^"]*all-parks-playgrounds-and-open-spaces/[a-z0-9][^"]*)"', h)]
    new = [x for x in m if x not in links]
    if not new: break
    links += new
out = []
for u in links:
    try: h = get(u)
    except Exception as e: out.append({"url": u, "err": str(e)}); continue
    s = re.sub(r"(?s)<(script|style|nav|header|footer)[^>]*>.*?</\1>", " ", h)
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s)))
    name = html.unescape(re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S).group(1)).strip() if "<h1" in h else ""
    addr = (re.search(r"Address (.*?) (Opening times|Facilities|Telephone|Location|Report)", t) or [None, ""])[1]
    age = (re.search(r"Play area \(age group\) (.{0,40}?years)", t) or [None, ""])[1]
    geo = re.search(r"(5[0-9]\.\d{4,})[\"']?\s*,\s*[\"']?(-[0-9]\.\d{4,})", h)
    out.append({"url": u, "name": re.sub(r"<[^>]+>", "", name), "addr": addr, "play": bool(re.search(r"(?i)play area|playground|play equipment", t)),
                "age": age, "wc": bool(re.search(r"(?i)\btoilet", t)), "opens": (re.search(r"Opening times (.{0,60}?) (Facilities|Telephone)", t) or [None, ""])[1],
                "geo": [float(geo.group(1)), float(geo.group(2))] if geo else None, "facil": (re.search(r"Facilities (.{0,400}?) (Transport|Report|Dogs|Location)", t) or [None, ""])[1]})
    time.sleep(0.3)
json.dump(out, open("tmp/mcr.json", "w"), indent=0)
print(len(links), sum(1 for o in out if o.get("play")))

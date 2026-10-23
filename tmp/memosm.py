import json, time, urllib.request, urllib.parse
sites = json.load(open("tmp/mem_sites.json"))
HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
def run(q):
    for h in HOSTS:
        for a in range(2):
            try:
                with urllib.request.urlopen(urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "swing-by-playground-audit"}), timeout=180) as r:
                    return json.load(r)
            except Exception as e:
                print("fail", h, e); time.sleep(5)
    return None
out = {}
for i in range(0, len(sites), 15):
    chunk = sites[i:i + 15]
    parts = "".join(f'nwr["leisure"="playground"](around:1500,{s["lat"]},{s["lng"]});' for s in chunk)
    j = run(f"[out:json][timeout:170];({parts});out center tags;")
    els = (j or {}).get("elements", [])
    for s in chunk:
        import math
        def km(a, b, c, d):
            r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
            return 12742 * math.asin(math.sqrt(h))
        c = []
        for e in els:
            cc = e.get("center", e); t = e.get("tags", {})
            d = km(s["lat"], s["lng"], cc["lat"], cc["lon"])
            if d <= 1.5: c.append(dict(osm=e["type"][0] + str(e["id"]), m=round(d * 1000), lat=cc["lat"], lng=cc["lon"], name=t.get("name", ""), access=t.get("access", ""), operator=t.get("operator", ""), fee=t.get("fee", "")))
        out[s["path"]] = sorted(c, key=lambda x: x["m"])[:6]
    time.sleep(3)
json.dump(out, open("tmp/memosm.json", "w"), indent=1)
print(len(out), sum(1 for v in out.values() if v))

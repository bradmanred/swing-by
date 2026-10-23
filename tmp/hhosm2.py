import json, time, math, urllib.request, urllib.parse
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
sites = json.load(open("tmp/hh_geo.json"))
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
HOSTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
todo = [s for s in sites if "lat" in s and not s.get("osm")]
for s in todo:
    c0 = (s.get("hlat", s["lat"]), s.get("hlng", s["lng"]))
    q = f'[out:json][timeout:60];nwr["leisure"="playground"](around:2000,{c0[0]},{c0[1]});out center tags;'
    j = None
    for h in HOSTS:
        try:
            with urllib.request.urlopen(urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA), timeout=90) as r:
                j = json.load(r); break
        except Exception as e:
            print("fail", s["path"], h, e); time.sleep(4)
    c = []
    for e in (j or {}).get("elements", []):
        cc = e.get("center", e); t = e.get("tags", {})
        c.append(dict(osm=e["type"][0] + str(e["id"]), m=round(km(c0[0], c0[1], cc["lat"], cc["lon"]) * 1000), lat=cc["lat"], lng=cc["lon"], name=t.get("name", ""), access=t.get("access", "")))
    s["osm"] = sorted(c, key=lambda x: x["m"])[:6]; s["osm_ok"] = j is not None
    time.sleep(2)
json.dump(sites, open("tmp/hh_geo.json", "w"), indent=1)
print(len(todo), sum(1 for s in todo if s.get("osm_ok")))
